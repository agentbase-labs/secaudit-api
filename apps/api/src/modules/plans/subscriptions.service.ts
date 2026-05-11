import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  ApiErrorCodes,
  PlanChangeRequestStatus,
  SubscriptionStatus,
} from '@cs-platform/shared';
import type {
  BillingCycle,
  PlanSlug,
  PublicSubscription,
  PublicUsageCounter,
  MeSubscriptionResponse,
} from '@cs-platform/shared';

import { Subscription } from './entities/subscription.entity';
import { PlanChangeRequest } from './entities/plan-change-request.entity';
import { UsageCounter } from './entities/usage-counter.entity';
import { PlansService } from './plans.service';
import { startOfUtcMonth } from './plans.constants';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription) private readonly subs: Repository<Subscription>,
    @InjectRepository(PlanChangeRequest)
    private readonly pcrs: Repository<PlanChangeRequest>,
    @InjectRepository(UsageCounter)
    private readonly counters: Repository<UsageCounter>,
    private readonly plans: PlansService,
  ) {}

  /** Returns the user's active subscription, or null. */
  async findActive(userId: string): Promise<Subscription | null> {
    return this.subs.findOne({
      where: { userId, status: SubscriptionStatus.ACTIVE },
      relations: { plan: true },
    });
  }

  async requireActive(userId: string): Promise<Subscription> {
    const sub = await this.findActive(userId);
    if (!sub || !sub.plan) {
      throw new NotFoundException({
        error: ApiErrorCodes.NOT_FOUND,
        message: 'No active subscription',
      });
    }
    return sub;
  }

  async findPendingChangeRequest(userId: string): Promise<PlanChangeRequest | null> {
    return this.pcrs.findOne({
      where: { userId, status: PlanChangeRequestStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Build the public `/me/subscription` payload (also embedded in `/auth/me`).
   */
  async getMeSubscription(userId: string): Promise<MeSubscriptionResponse> {
    const sub = await this.requireActive(userId);
    const pending = await this.findPendingChangeRequest(userId);

    const periodStart = startOfUtcMonth(new Date());
    const counter = await this.counters.findOne({
      where: { userId, periodStart },
    });

    const usage: PublicUsageCounter = counter
      ? {
          periodStart: counter.periodStart.toISOString(),
          submissionsCount: counter.submissionsCount,
          sourceReviewsCount: counter.sourceReviewsCount,
          manualPentestsCountYtd: counter.manualPentestsCountYtd,
          mobileUploadBytesUsed: String(counter.mobileUploadBytesUsed),
        }
      : {
          periodStart: periodStart.toISOString(),
          submissionsCount: 0,
          sourceReviewsCount: 0,
          manualPentestsCountYtd: 0,
          mobileUploadBytesUsed: '0',
        };

    return {
      subscription: this.toPublic(sub, pending),
      usage,
    };
  }

  toPublic(sub: Subscription, pending: PlanChangeRequest | null): PublicSubscription {
    if (!sub.plan) {
      // Caller should ensure plan relation is loaded.
      throw new Error('Subscription.plan relation must be loaded for toPublic()');
    }
    return {
      id: sub.id,
      status: sub.status,
      billingCycle: sub.billingCycle,
      startedAt: sub.startedAt.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      requestedPlanId: (sub.requestedPlanId as PlanSlug | null) ?? null,
      plan: {
        id: sub.plan.id as PlanSlug,
        name: sub.plan.name,
        caps: sub.plan.caps,
      },
      pendingChangeRequest: pending
        ? {
            id: pending.id,
            toPlanId: pending.toPlanId as PlanSlug,
            billingCycle: pending.billingCycle,
            createdAt: pending.createdAt.toISOString(),
          }
        : null,
      requestedPlan: pending ? (pending.toPlanId as PlanSlug) : null,
    };
  }

  /**
   * Create a subscription row inside an existing transaction. Used by
   * AuthService.register so the user + sub are persisted atomically.
   */
  async createInitialFreeInTx(em: EntityManager, userId: string, startedAt: Date): Promise<Subscription> {
    const entity = em.create(Subscription, {
      userId,
      planId: 'free',
      status: SubscriptionStatus.ACTIVE,
      billingCycle: null,
      startedAt,
      currentPeriodEnd: null,
      cancelledAt: null,
      requestedPlanId: null,
    });
    return em.save(entity);
  }

  /**
   * Supersede any existing PENDING PCR (mark old as REJECTED with note
   * 'superseded') then create a new pending row. Returns the new PCR.
   */
  async createOrSupersedePendingPcr(args: {
    em?: EntityManager;
    userId: string;
    fromPlanId: string;
    toPlanId: string;
    billingCycle: BillingCycle;
    notes?: string | null;
  }): Promise<PlanChangeRequest> {
    const run = async (m: EntityManager) => {
      // Supersede any prior pending row (one-at-a-time invariant).
      await m
        .createQueryBuilder()
        .update(PlanChangeRequest)
        .set({
          status: PlanChangeRequestStatus.REJECTED,
          notes: 'superseded',
          processedAt: new Date(),
        })
        .where('userId = :uid AND status = :s', {
          uid: args.userId,
          s: PlanChangeRequestStatus.PENDING,
        })
        .execute();

      const pcr = m.create(PlanChangeRequest, {
        userId: args.userId,
        fromPlanId: args.fromPlanId,
        toPlanId: args.toPlanId,
        billingCycle: args.billingCycle,
        status: PlanChangeRequestStatus.PENDING,
        notes: args.notes ?? null,
      });
      return m.save(pcr);
    };

    if (args.em) return run(args.em);
    return this.pcrs.manager.transaction(run);
  }

  /**
   * Apply a plan change directly (admin override / approval path).
   * Updates the active subscription's planId + billingCycle + currentPeriodEnd.
   * Caller is expected to wrap in a transaction.
   */
  async applyPlanChange(
    em: EntityManager,
    userId: string,
    toPlanId: string,
    billingCycle: BillingCycle,
  ): Promise<Subscription> {
    const sub = await em.findOne(Subscription, {
      where: { userId, status: SubscriptionStatus.ACTIVE },
      relations: { plan: true },
    });
    if (!sub) {
      throw new NotFoundException({
        error: ApiErrorCodes.NOT_FOUND,
        message: 'No active subscription',
      });
    }
    sub.planId = toPlanId;
    sub.billingCycle = billingCycle;
    sub.requestedPlanId = null;
    const now = new Date();
    if (toPlanId === 'free') {
      sub.currentPeriodEnd = null;
    } else {
      const end = new Date(now);
      if (billingCycle === 'annual') {
        end.setUTCFullYear(end.getUTCFullYear() + 1);
      } else {
        end.setUTCMonth(end.getUTCMonth() + 1);
      }
      sub.currentPeriodEnd = end;
    }
    await em.save(sub);
    // Reload with plan relation for response shape.
    const reloaded = await em.findOne(Subscription, {
      where: { id: sub.id },
      relations: { plan: true },
    });
    return reloaded!;
  }
}
