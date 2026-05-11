import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ApiErrorCodes,
  PlanChangeRequestStatus,
} from '@cs-platform/shared';
import type { BillingCycle, PlanSlug } from '@cs-platform/shared';

import { AuditService } from '../audit/audit.service';
import { PlanChangeRequest } from './entities/plan-change-request.entity';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class PlanChangeRequestsService {
  private readonly logger = new Logger(PlanChangeRequestsService.name);

  constructor(
    @InjectRepository(PlanChangeRequest)
    private readonly repo: Repository<PlanChangeRequest>,
    private readonly plans: PlansService,
    private readonly subs: SubscriptionsService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /** User-driven plan change request (creates pending PCR). */
  async requestChange(args: {
    userId: string;
    toPlanId: string;
    billingCycle: BillingCycle;
  }): Promise<PlanChangeRequest> {
    const sub = await this.subs.requireActive(args.userId);

    // Reject identity changes.
    if (args.toPlanId === sub.planId) {
      throw new ConflictException({
        error: 'already_on_plan',
        message: `You are already on ${sub.planId}`,
      });
    }

    // Plan must exist.
    await this.plans.requireById(args.toPlanId);

    // Enterprise self-serve: behaviour TBD (sales call). For now allow PCR
    // creation; ops will pick it up. Doc \u00a73.4 says "we'll be in touch".
    const pcr = await this.subs.createOrSupersedePendingPcr({
      userId: args.userId,
      fromPlanId: sub.planId,
      toPlanId: args.toPlanId,
      billingCycle: args.billingCycle,
    });

    await this.audit.record({
      actorUserId: args.userId,
      action: 'subscription.change_requested',
      targetType: 'PlanChangeRequest',
      targetId: pcr.id,
      meta: { fromPlanId: pcr.fromPlanId, toPlanId: pcr.toPlanId, billingCycle: pcr.billingCycle },
    });
    return pcr;
  }

  // ---------------- Admin ----------------

  async list(filters: {
    status?: PlanChangeRequestStatus;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const qb = this.repo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'u')
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (filters.status) qb.andWhere('p.status = :s', { s: filters.status });
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((r) => ({
        id: r.id,
        user: r.user
          ? {
              id: r.user.id,
              email: r.user.email,
              fullName: r.user.fullName,
              companyName: r.user.companyName,
            }
          : null,
        fromPlanId: r.fromPlanId as PlanSlug,
        toPlanId: r.toPlanId as PlanSlug,
        billingCycle: r.billingCycle,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
        processedBy: r.processedBy,
        notes: r.notes,
      })),
      page,
      pageSize,
      total,
    };
  }

  async approve(args: {
    pcrId: string;
    adminId: string;
    notes?: string;
    ip?: string | null;
  }) {
    const pcr = await this.repo.findOne({ where: { id: args.pcrId } });
    if (!pcr) {
      throw new NotFoundException({
        error: ApiErrorCodes.NOT_FOUND,
        message: 'Plan change request not found',
      });
    }
    if (pcr.status !== PlanChangeRequestStatus.PENDING) {
      throw new ConflictException({
        error: 'pcr_not_pending',
        message: `Request is ${pcr.status}, cannot approve`,
      });
    }

    const updatedSub = await this.dataSource.transaction(async (m) => {
      const sub = await this.subs.applyPlanChange(
        m,
        pcr.userId,
        pcr.toPlanId,
        pcr.billingCycle,
      );
      pcr.status = PlanChangeRequestStatus.APPROVED;
      pcr.processedAt = new Date();
      pcr.processedBy = args.adminId;
      pcr.notes = args.notes ?? pcr.notes;
      await m.save(pcr);
      return sub;
    });

    await this.audit.record({
      actorUserId: args.adminId,
      action: 'subscription.upgraded',
      targetType: 'Subscription',
      targetId: updatedSub.id,
      ip: args.ip ?? null,
      meta: {
        pcrId: pcr.id,
        userId: pcr.userId,
        fromPlanId: pcr.fromPlanId,
        toPlanId: pcr.toPlanId,
        billingCycle: pcr.billingCycle,
      },
    });

    return { pcr, subscription: updatedSub };
  }

  async reject(args: {
    pcrId: string;
    adminId: string;
    notes: string;
    ip?: string | null;
  }) {
    if (!args.notes || args.notes.length < 5) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Reject reason (notes) is required (5\u20131000 chars).',
      });
    }
    const pcr = await this.repo.findOne({ where: { id: args.pcrId } });
    if (!pcr) {
      throw new NotFoundException({
        error: ApiErrorCodes.NOT_FOUND,
        message: 'Plan change request not found',
      });
    }
    if (pcr.status !== PlanChangeRequestStatus.PENDING) {
      throw new ConflictException({
        error: 'pcr_not_pending',
        message: `Request is ${pcr.status}, cannot reject`,
      });
    }
    pcr.status = PlanChangeRequestStatus.REJECTED;
    pcr.processedAt = new Date();
    pcr.processedBy = args.adminId;
    pcr.notes = args.notes;
    await this.repo.save(pcr);

    await this.audit.record({
      actorUserId: args.adminId,
      action: 'subscription.change_rejected',
      targetType: 'PlanChangeRequest',
      targetId: pcr.id,
      ip: args.ip ?? null,
      meta: { userId: pcr.userId, toPlanId: pcr.toPlanId, notes: pcr.notes },
    });
    return pcr;
  }
}
