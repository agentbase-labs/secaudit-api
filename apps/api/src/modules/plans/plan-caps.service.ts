import { Injectable, InternalServerErrorException, Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { PlanCaps } from '@cs-platform/shared';
import { SubscriptionStatus, TestingType } from '@cs-platform/shared';

import { Subscription } from './entities/subscription.entity';
import { PlanCapExceededException } from './plan-cap-exceeded.exception';
import { startOfUtcMonth } from './plans.constants';

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

  /**
   * Atomically reserve a submission slot for `userId` in the current UTC
   * month, then verify the new counts against the user's plan caps.
   *
   * MUST run inside a caller-provided transaction (`manager`). The caller
   * is responsible for rolling back on cap-exceeded — that automatically
   * reverts the counter increments because they live in the same tx.
   *
   * SQL strategy (per design doc §5.1 + §11 decision #2):
   *   - One round-trip `INSERT … ON CONFLICT (userId, periodStart) DO UPDATE`
   *     with `RETURNING` — atomic at the row-lock level.
   *   - First-of-month case: row doesn't exist → INSERT path with starting
   *     values of 1 / 0 / 0 (per-type increments computed from `testingType`).
   *   - Subsequent same-month: ON CONFLICT path → `+ 1` to submissionsCount
   *     and conditional `+ 1` to per-type sub-counters.
   *   - `RETURNING` gives us the *post-increment* counts, which we then
   *     compare against the caps. If any cap is exceeded, throw — the
   *     caller's transaction rolls back, undoing the increment.
   *
   * Concurrency: two simultaneous calls for the same (userId, periodStart)
   * serialize on the unique-index row lock. Each gets its own RETURNING
   * value; only the one(s) whose post-increment value ≤ cap survive.
   *
   * Cap semantics:
   *   - submissionsPerMonth === -1 → unlimited (skip check).
   *   - perTypeSubmissionsPerMonth[testingType] === undefined/null →
   *     no per-type cap (skip).
   *   - manualPentestsPerYear: NOT enforced here. The denormalized
   *     `manualPentestsCountYtd` is a display cache only (per §5.3).
   *     Real YTD enforcement runs as a live `COUNT(*)` against
   *     testing_requests in the guard; we still increment the cache here.
   */
  async atomicIncrementAndCheck(
    manager: EntityManager,
    userId: string,
    testingType: TestingType,
    enforced: boolean,
  ): Promise<void> {
    if (!enforced) {
      // Kill-switch off: we still increment so display counters stay
      // accurate, but we never reject.
      await this.runIncrementSql(manager, userId, testingType);
      return;
    }

    const { planId, caps } = await this.getCaps(userId);

    const row = await this.runIncrementSql(manager, userId, testingType);

    // 1. submissionsPerMonth (the headline cap)
    if (
      caps.submissionsPerMonth !== -1 &&
      row.submissionsCount > caps.submissionsPerMonth
    ) {
      throw new PlanCapExceededException({
        cap: 'SUBMISSIONS_PER_MONTH',
        // Report the cap value as `current` so the user sees the limit, not
        // the post-increment overshoot which is just an artifact of TOCTOU.
        current: caps.submissionsPerMonth,
        max: caps.submissionsPerMonth,
        currentPlanId: planId,
      });
    }

    // 2. Per-type sub-cap (e.g. business plan: 1 source_review/mo within the
    //    overall 30 submissions budget)
    const subCap = caps.perTypeSubmissionsPerMonth?.[testingType];
    if (subCap !== undefined && subCap !== null) {
      const usedThisType =
        testingType === TestingType.SOURCE_REVIEW
          ? row.sourceReviewsCount
          : testingType === TestingType.MANUAL_PENTEST
            ? row.manualPentestsCountYtd
            : null;
      // Only source_review and manual_pentest have dedicated counters.
      // For other types, per-type sub-caps would need new columns; for
      // now we treat them as not-enforced-here (guard will reject earlier
      // for shape, or cap is moot).
      if (usedThisType !== null && usedThisType > subCap) {
        throw new PlanCapExceededException({
          cap: `PER_TYPE_${testingType.toUpperCase()}`,
          current: subCap,
          max: subCap,
          currentPlanId: planId,
        });
      }
    }
  }

  /**
   * Emits the UPSERT and returns the post-increment row.
   * Extracted from `atomicIncrementAndCheck` for unit-testability of the
   * SQL surface itself.
   */
  private async runIncrementSql(
    manager: EntityManager,
    userId: string,
    testingType: TestingType,
  ): Promise<{
    submissionsCount: number;
    sourceReviewsCount: number;
    manualPentestsCountYtd: number;
  }> {
    const periodStart = startOfUtcMonth(new Date());
    const sql = `
      INSERT INTO usage_counters
        (id, "userId", "periodStart", "submissionsCount",
         "sourceReviewsCount", "manualPentestsCountYtd",
         "mobileUploadBytesUsed", "lastResetAt", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), $1, $2, 1,
         CASE WHEN $3 = 'source_review' THEN 1 ELSE 0 END,
         CASE WHEN $3 = 'manual_pentest' THEN 1 ELSE 0 END,
         0, now(), now(), now())
      ON CONFLICT ("userId", "periodStart") DO UPDATE SET
        "submissionsCount" = usage_counters."submissionsCount" + 1,
        "sourceReviewsCount" = usage_counters."sourceReviewsCount"
          + CASE WHEN $3 = 'source_review' THEN 1 ELSE 0 END,
        "manualPentestsCountYtd" = usage_counters."manualPentestsCountYtd"
          + CASE WHEN $3 = 'manual_pentest' THEN 1 ELSE 0 END,
        "updatedAt" = now()
      RETURNING "submissionsCount", "sourceReviewsCount", "manualPentestsCountYtd"
    `;
    const result = (await manager.query(sql, [userId, periodStart, testingType])) as Array<{
      submissionsCount: number | string;
      sourceReviewsCount: number | string;
      manualPentestsCountYtd: number | string;
    }>;
    const r = result[0];
    if (!r) {
      throw new InternalServerErrorException({
        error: 'usage_counter_upsert_failed',
        message: 'Atomic counter upsert returned no rows',
      });
    }
    return {
      submissionsCount: Number(r.submissionsCount),
      sourceReviewsCount: Number(r.sourceReviewsCount),
      manualPentestsCountYtd: Number(r.manualPentestsCountYtd),
    };
  }

  /**
   * Atomically reserve an ACTIVE-SCAN slot for `userId` in the current UTC
   * month, then verify the new count against `activeScansPerMonth`.
   *
   * Same TOCTOU-safe pattern as `atomicIncrementAndCheck` (design doc §7.3):
   * one `INSERT … ON CONFLICT (userId, periodStart) DO UPDATE … RETURNING`
   * round-trip, post-increment cap-check, caller's transaction rolls back on
   * throw (which reverts the increment).
   *
   * MUST run inside a caller-provided transaction (`manager`).
   *
   * Cap semantics:
   *   - activeScansPerMonth === -1 → unlimited (skip check).
   *   - activeScansPerMonth === 0 / undefined → disabled (reject; but the
   *     caller / guard should have rejected entitlement *before* calling
   *     here — this is defense-in-depth).
   *   - enforced=false → still increments (display accuracy) but never throws.
   */
  async atomicIncrementActiveScanAndCheck(
    manager: EntityManager,
    userId: string,
    enforced: boolean,
  ): Promise<void> {
    if (!enforced) {
      await this.runActiveScanIncrementSql(manager, userId);
      return;
    }

    const { planId, caps } = await this.getCaps(userId);
    const perMonth = caps.activeScansPerMonth ?? 0;

    const count = await this.runActiveScanIncrementSql(manager, userId);

    if (perMonth === -1) return; // unlimited

    if (perMonth === 0 || count > perMonth) {
      throw new PlanCapExceededException({
        cap: 'ACTIVE_SCANS_PER_MONTH',
        current: perMonth,
        max: perMonth,
        currentPlanId: planId,
      });
    }
  }

  /** UPSERT the activeScansCount and return the post-increment value. */
  private async runActiveScanIncrementSql(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const periodStart = startOfUtcMonth(new Date());
    const sql = `
      INSERT INTO usage_counters
        (id, "userId", "periodStart", "submissionsCount",
         "sourceReviewsCount", "manualPentestsCountYtd", "activeScansCount",
         "mobileUploadBytesUsed", "lastResetAt", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), $1, $2, 0, 0, 0, 1, 0, now(), now(), now())
      ON CONFLICT ("userId", "periodStart") DO UPDATE SET
        "activeScansCount" = usage_counters."activeScansCount" + 1,
        "updatedAt" = now()
      RETURNING "activeScansCount"
    `;
    const result = (await manager.query(sql, [userId, periodStart])) as Array<{
      activeScansCount: number | string;
    }>;
    const r = result[0];
    if (!r) {
      throw new InternalServerErrorException({
        error: 'usage_counter_upsert_failed',
        message: 'Active-scan atomic counter upsert returned no rows',
      });
    }
    return Number(r.activeScansCount);
  }
}
