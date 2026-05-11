import { Injectable, InternalServerErrorException, Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PlanCaps } from '@cs-platform/shared';
import { SubscriptionStatus } from '@cs-platform/shared';

import { Subscription } from './entities/subscription.entity';

/**
 * Per-request memoized resolver for "what plan caps does this user get?".
 *
 * Lifecycle: REQUEST scope → one instance per HTTP request. Multiple guards
 * + services in the same request share the same instance and therefore
 * share the in-memory cache (single DB hit per request).
 *
 * Caps are read from the user's active Subscription -> Plan join.
 * Cross-request caching is deferred (Postgres + a single index hit is cheap).
 */
@Injectable({ scope: Scope.REQUEST })
export class PlanCapsService {
  private cache: { planId: string; caps: PlanCaps; subscriptionId: string } | null = null;

  constructor(
    @InjectRepository(Subscription)
    private readonly subs: Repository<Subscription>,
  ) {}

  async getCaps(userId: string): Promise<{
    planId: string;
    caps: PlanCaps;
    subscriptionId: string;
  }> {
    if (this.cache) return this.cache;

    const sub = await this.subs.findOne({
      where: { userId, status: SubscriptionStatus.ACTIVE },
      relations: { plan: true },
    });
    if (!sub || !sub.plan) {
      // Defensive: should never happen — backfill migration creates a Free
      // sub for every user. Surface as 500, not silent fallback, so the
      // gap is loud in logs.
      throw new InternalServerErrorException({
        error: 'no_active_subscription',
        message: 'User has no active subscription',
      });
    }
    this.cache = { planId: sub.planId, caps: sub.plan.caps, subscriptionId: sub.id };
    return this.cache;
  }
}
