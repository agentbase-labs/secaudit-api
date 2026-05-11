import { ExecutionContext } from '@nestjs/common';
import { AssetType, TestingType } from '@cs-platform/shared';

import { AppConfigService } from '../../../config/config.service';
import { TestingRequest } from '../../requests/entities/testing-request.entity';
import { PlanCapsService } from '../plan-caps.service';
import { UsageCounter } from '../entities/usage-counter.entity';
import { PlanCapGuard } from './plan-cap.guard';

/**
 * Tests for the cap-enforcement guard (defense-in-depth pre-check).
 *
 * The submissions-per-month + per-type sub-cap checks moved out of this
 * guard into `PlanCapsService.atomicIncrementAndCheck` (called inside
 * `RequestsService.create`) to close the TOCTOU race — see design doc
 * §11 decision #2 and `atomic-counter.spec.ts` for that surface.
 *
 * What this spec still covers:
 *   1. Short-circuit when env flag is off.
 *   2. Allow when DTO is well-formed and within all cap-shape limits.
 *   3. Reject when testingType not in allow-list.
 *   4. Reject mobile uploads when mobileUploadMaxMb === 0.
 *   5. Reject manual_pentest when manualPentestsPerYear === 0.
 *   6. Reject red_team when redTeamEnabled === false.
 *   7. Reject when registeredAssetsMax would be exceeded.
 */

function makeCtx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function freshCaps(overrides: Record<string, unknown> = {}) {
  return {
    submissionsPerMonth: 1,
    registeredAssetsMax: -1,
    manualPentestsPerYear: 0,
    mobileUploadMaxMb: 200,
    seatsMax: 1,
    retentionDays: 30,
    perTypeSubmissionsPerMonth: null,
    allowedAssetTypes: [
      AssetType.WEBSITE,
      AssetType.ATTACK_SURFACE,
      AssetType.EXTERNAL_INFRA,
      AssetType.MOBILE_APP,
    ],
    allowedTestingTypes: [
      TestingType.VULN_SCAN,
      TestingType.API_TEST,
      TestingType.SOURCE_REVIEW,
    ],
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

describe('PlanCapGuard', () => {
  const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  function buildGuard(opts: {
    envEnforced?: boolean;
    caps?: ReturnType<typeof freshCaps>;
    /**
     * Convenience: pre-populate the testing-request count returned by
     * the QueryBuilder (used by the registered-assets and YTD checks).
     */
    requestCounts?: { count?: number; distinctAssets?: number };
  }) {
    const cfg = {
      get: (key: string) =>
        key === 'PLAN_CAPS_ENFORCED' ? (opts.envEnforced ? 'true' : 'false') : undefined,
    } as unknown as AppConfigService;

    const capsService = {
      getCaps: jest.fn().mockResolvedValue({
        planId: 'free',
        caps: opts.caps ?? freshCaps(),
        subscriptionId: 'sub-1',
      }),
    } as unknown as PlanCapsService;

    // We don't read the counters table from the guard anymore (atomic
    // increment in service handles it). Provide a no-op stub.
    const counterRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as { findOne: jest.Mock };

    const distinctAssets = String(opts.requestCounts?.distinctAssets ?? 0);
    const yearCount = opts.requestCounts?.count ?? 0;

    // The guard makes two QueryBuilder chains for registered-assets:
    //   call 1: SELECT COUNT(DISTINCT …)         → getRawOne returns { cnt }
    //   call 2: SELECT 1 WHERE asset-key = …     → getRawOne returns null/`1`
    // We mock the FIRST call to return the distinct count and the SECOND
    // (existence probe) to return null (i.e. "new asset, would add"). The
    // YTD path uses getCount, mocked once.
    let qbCall = 0;
    const requestRepo = {
      createQueryBuilder: jest.fn().mockImplementation(() => {
        const callIndex = qbCall++;
        const builder = {
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue(
            callIndex === 0 ? { cnt: distinctAssets } : null,
          ),
          getCount: jest.fn().mockResolvedValue(yearCount),
        };
        return builder;
      }),
    } as unknown as { createQueryBuilder: jest.Mock };

    return new PlanCapGuard(
      capsService,
      counterRepo as unknown as import('typeorm').Repository<UsageCounter>,
      requestRepo as unknown as import('typeorm').Repository<TestingRequest>,
      cfg,
    );
  }

  function ctxFor(body: Record<string, unknown>) {
    return makeCtx({
      user: { id: userId, email: 'u@example.com', role: 'client', emailVerified: true },
      body,
    });
  }

  it('short-circuits to true when PLAN_CAPS_ENFORCED is not "true"', async () => {
    const guard = buildGuard({ envEnforced: false });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows the request when DTO matches plan shape (submissions cap NOT checked here)', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({ submissionsPerMonth: 3 }),
    });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('does NOT reject on submissions-per-month overshoot (that moved to the service)', async () => {
    // Even with submissions cap=1 and "999 used", the guard is silent now —
    // the atomic UPSERT in RequestsService.create is the authority.
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({ submissionsPerMonth: 1 }),
    });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects with 402 when testing type is not in allow-list', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({ allowedTestingTypes: [TestingType.VULN_SCAN] }),
    });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.MANUAL_PENTEST,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({
        cap: 'TESTING_TYPE_NOT_ALLOWED',
      }),
    });
  });

  it('rejects mobile uploads when mobileUploadMaxMb is 0 (free/starter)', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({ mobileUploadMaxMb: 0 }),
    });
    const ctx = ctxFor({
      assetType: AssetType.MOBILE_APP,
      testingType: TestingType.VULN_SCAN,
      details: { packageName: 'com.example.app' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({ cap: 'MOBILE_UPLOAD_DISABLED' }),
    });
  });

  it('rejects manual_pentest when manualPentestsPerYear === 0', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({
        allowedTestingTypes: [TestingType.MANUAL_PENTEST],
        manualPentestsPerYear: 0,
      }),
    });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.MANUAL_PENTEST,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({ cap: 'MANUAL_PENTEST_DISABLED' }),
    });
  });

  it('rejects red_team when redTeamEnabled is false', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({
        allowedTestingTypes: [TestingType.RED_TEAM],
        redTeamEnabled: false,
      }),
    });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.RED_TEAM,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({ cap: 'RED_TEAM_DISABLED' }),
    });
  });

  it('rejects when distinct asset count would exceed registeredAssetsMax', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({ registeredAssetsMax: 1 }),
      requestCounts: { distinctAssets: 1 },
    });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      // New URL → would push distinct assets from 1 → 2, exceeding cap of 1.
      details: { url: 'https://new.example' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({ cap: 'REGISTERED_ASSETS_MAX' }),
    });
  });
});
