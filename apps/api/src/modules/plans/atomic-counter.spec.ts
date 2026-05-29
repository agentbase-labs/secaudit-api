import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SubscriptionStatus, TestingType } from '@cs-platform/shared';

import { PlanCapsService } from './plan-caps.service';
import { Subscription } from './entities/subscription.entity';

/**
 * Unit tests for `PlanCapsService.atomicIncrementAndCheck` — the SQL
 * surface that closes the TOCTOU race (design doc §11 decision #2).
 *
 * Strategy:
 *   - Mock EntityManager.query so we can inspect the exact SQL emitted
 *     and the parameter array.
 *   - Verify the UPSERT is shaped correctly (idempotent on first row,
 *     +1 on conflict path, conditional per-type increments).
 *   - Verify post-increment cap-check semantics (overshoot triggers 402).
 *
 * Why we don't run real SQL: there is no Postgres available in this
 * test infra (see PROGRESS.md / test/jest-setup.ts). We test the SQL
 * shape here; concurrency-under-load semantics are tested in
 * `test/plan-cap-concurrency.e2e-spec.ts` via a stand-in shared counter.
 */

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeCapsRow(overrides: Record<string, unknown> = {}) {
  return {
    submissionsPerMonth: 5,
    registeredAssetsMax: -1,
    manualPentestsPerYear: 0,
    mobileUploadMaxMb: 0,
    seatsMax: 1,
    retentionDays: 30,
    perTypeSubmissionsPerMonth: null,
    allowedAssetTypes: ['website'],
    allowedTestingTypes: ['vuln_scan', 'source_review', 'manual_pentest'],
    redTeamEnabled: false,
    ssoEnabled: false,
    complianceReportEnabled: false,
    auditLogAccess: false,
    retestsPerRequest: null,
    slaVulnBusinessDays: null,
    slaPentestBusinessDays: null,
    supportTier: 'community',
    ...overrides,
  };
}

async function buildService(args: {
  caps?: Record<string, unknown>;
  planId?: string;
}): Promise<PlanCapsService> {
  const fakeSub = {
    id: 'sub-1',
    userId,
    planId: args.planId ?? 'starter',
    status: SubscriptionStatus.ACTIVE,
    plan: {
      id: args.planId ?? 'starter',
      name: args.planId ?? 'starter',
      caps: args.caps ?? makeCapsRow(),
    },
  };
  const repoMock: Partial<Repository<Subscription>> = {
    findOne: jest.fn().mockResolvedValue(fakeSub),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      PlanCapsService,
      { provide: getRepositoryToken(Subscription), useValue: repoMock },
    ],
  }).compile();
  return moduleRef.resolve(PlanCapsService);
}

function fakeManager(returnRow: {
  submissionsCount: number;
  sourceReviewsCount: number;
  manualPentestsCountYtd: number;
}): { manager: EntityManager; query: jest.Mock } {
  const query = jest.fn().mockResolvedValue([returnRow]);
  const manager = { query } as unknown as EntityManager;
  return { manager, query };
}

describe('PlanCapsService.atomicIncrementAndCheck', () => {
  it('emits an UPSERT (INSERT … ON CONFLICT) with RETURNING and correct params', async () => {
    const svc = await buildService({});
    const { manager, query } = fakeManager({
      submissionsCount: 1,
      sourceReviewsCount: 0,
      manualPentestsCountYtd: 0,
    });

    await svc.atomicIncrementAndCheck(manager, userId, TestingType.VULN_SCAN, true);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;

    // Shape: INSERT … ON CONFLICT … DO UPDATE … RETURNING
    expect(sql).toMatch(/INSERT INTO usage_counters/i);
    expect(sql).toMatch(/ON CONFLICT \("userId", "periodStart"\)/i);
    expect(sql).toMatch(/DO UPDATE SET/i);
    expect(sql).toMatch(/"submissionsCount" = usage_counters\."submissionsCount" \+ 1/);
    expect(sql).toMatch(/RETURNING/);
    expect(sql).toMatch(/"submissionsCount"/);
    expect(sql).toMatch(/"sourceReviewsCount"/);
    expect(sql).toMatch(/"manualPentestsCountYtd"/);

    // Idempotent first-of-month: starting submissionsCount = 1
    expect(sql).toMatch(/VALUES\s*\(\s*gen_random_uuid\(\),\s*\$1,\s*\$2,\s*1,/);

    // Per-type conditional increments rely on the third bind param ($3).
    expect(sql).toMatch(/CASE WHEN \$3 = 'source_review' THEN 1 ELSE 0 END/);
    expect(sql).toMatch(/CASE WHEN \$3 = 'manual_pentest' THEN 1 ELSE 0 END/);

    // Params: [userId, periodStart, testingType]
    expect(params).toHaveLength(3);
    expect(params[0]).toBe(userId);
    expect(params[1]).toBeInstanceOf(Date);
    // periodStart should be the first instant of the current UTC month
    const ps = params[1] as Date;
    expect(ps.getUTCDate()).toBe(1);
    expect(ps.getUTCHours()).toBe(0);
    expect(ps.getUTCMinutes()).toBe(0);
    expect(params[2]).toBe(TestingType.VULN_SCAN);
  });

  it('passes testingType=source_review so the source-reviews counter increments', async () => {
    const svc = await buildService({});
    const { manager, query } = fakeManager({
      submissionsCount: 1,
      sourceReviewsCount: 1,
      manualPentestsCountYtd: 0,
    });

    await svc.atomicIncrementAndCheck(manager, userId, TestingType.SOURCE_REVIEW, true);

    expect(query.mock.calls[0]![1][2]).toBe('source_review');
  });

  it('passes testingType=manual_pentest so the manual-pentest counter increments', async () => {
    const svc = await buildService({});
    const { manager, query } = fakeManager({
      submissionsCount: 1,
      sourceReviewsCount: 0,
      manualPentestsCountYtd: 1,
    });

    await svc.atomicIncrementAndCheck(manager, userId, TestingType.MANUAL_PENTEST, true);

    expect(query.mock.calls[0]![1][2]).toBe('manual_pentest');
  });

  it('throws PlanCapExceededException with cap=SUBMISSIONS_PER_MONTH when post-increment > submissionsPerMonth', async () => {
    const svc = await buildService({
      planId: 'starter',
      caps: makeCapsRow({ submissionsPerMonth: 1 }),
    });
    // RETURNING value of 2 means a second concurrent caller saw the counter
    // jump from 1 → 2, which is already over the cap of 1.
    const { manager } = fakeManager({
      submissionsCount: 2,
      sourceReviewsCount: 0,
      manualPentestsCountYtd: 0,
    });

    await expect(
      svc.atomicIncrementAndCheck(manager, userId, TestingType.VULN_SCAN, true),
    ).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({
        code: 'PLAN_CAP_EXCEEDED',
        cap: 'SUBMISSIONS_PER_MONTH',
        max: 1,
        current: 1,
        suggestUpgradeTo: 'pro',
      }),
    });
  });

  it('passes when post-increment value equals the cap exactly (boundary)', async () => {
    const svc = await buildService({
      caps: makeCapsRow({ submissionsPerMonth: 3 }),
    });
    const { manager } = fakeManager({
      submissionsCount: 3,
      sourceReviewsCount: 0,
      manualPentestsCountYtd: 0,
    });
    await expect(
      svc.atomicIncrementAndCheck(manager, userId, TestingType.VULN_SCAN, true),
    ).resolves.toBeUndefined();
  });

  it('skips submissionsPerMonth when cap is -1 (unlimited)', async () => {
    const svc = await buildService({
      caps: makeCapsRow({ submissionsPerMonth: -1 }),
    });
    const { manager } = fakeManager({
      submissionsCount: 9999,
      sourceReviewsCount: 0,
      manualPentestsCountYtd: 0,
    });
    await expect(
      svc.atomicIncrementAndCheck(manager, userId, TestingType.VULN_SCAN, true),
    ).resolves.toBeUndefined();
  });

  it('honors enforced=false: still increments (display cache stays accurate) but never throws', async () => {
    const svc = await buildService({
      caps: makeCapsRow({ submissionsPerMonth: 1 }),
    });
    const { manager, query } = fakeManager({
      submissionsCount: 9999, // way over the cap
      sourceReviewsCount: 0,
      manualPentestsCountYtd: 0,
    });

    // enforced=false → no exception even when post-increment way past cap
    await expect(
      svc.atomicIncrementAndCheck(manager, userId, TestingType.VULN_SCAN, false),
    ).resolves.toBeUndefined();

    // Counter SQL still ran (display accuracy)
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('throws PER_TYPE_<TYPE> when a per-type sub-cap is exceeded', async () => {
    const svc = await buildService({
      planId: 'business',
      caps: makeCapsRow({
        submissionsPerMonth: 30,
        perTypeSubmissionsPerMonth: { source_review: 1 },
      }),
    });
    const { manager } = fakeManager({
      submissionsCount: 5,        // well under overall cap
      sourceReviewsCount: 2,      // post-increment overshoot of source_review cap=1
      manualPentestsCountYtd: 0,
    });

    await expect(
      svc.atomicIncrementAndCheck(manager, userId, TestingType.SOURCE_REVIEW, true),
    ).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({
        code: 'PLAN_CAP_EXCEEDED',
        cap: 'PER_TYPE_SOURCE_REVIEW',
      }),
    });
  });
});
