import { ExecutionContext } from '@nestjs/common';
import { AssetType, TestingType } from '@cs-platform/shared';

import { AppConfigService } from '../../../config/config.service';
import { TestingRequest } from '../../requests/entities/testing-request.entity';
import { PlanCapsService } from '../plan-caps.service';
import { UsageCounter } from '../entities/usage-counter.entity';
import { PlanCapGuard } from './plan-cap.guard';

/**
 * Tests for the cap-enforcement guard.
 * Focused on the contract:
 *   1. Short-circuit when env flag is off.
 *   2. 402 when over submissionsPerMonth.
 *   3. Allow when under cap.
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
    submissionsCount?: number;
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

    const counterRepo = {
      findOne: jest.fn().mockResolvedValue(
        opts.submissionsCount !== undefined
          ? { submissionsCount: opts.submissionsCount }
          : null,
      ),
    } as unknown as { findOne: jest.Mock };

    // Builder that returns counts of 0 by default.
    const requestRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ cnt: '0' }),
        getCount: jest.fn().mockResolvedValue(0),
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
    const guard = buildGuard({ envEnforced: false, submissionsCount: 999 });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows the request when usage is below the monthly cap', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({ submissionsPerMonth: 3 }),
      submissionsCount: 1,
    });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects with 402 when over submissionsPerMonth', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({ submissionsPerMonth: 1 }),
      submissionsCount: 1,
    });
    const ctx = ctxFor({
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      details: { url: 'https://x.example' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({
        code: 'PLAN_CAP_EXCEEDED',
        cap: 'SUBMISSIONS_PER_MONTH',
        suggestUpgradeTo: 'starter',
      }),
    });
  });

  it('rejects with 402 when testing type is not in allow-list', async () => {
    const guard = buildGuard({
      envEnforced: true,
      caps: freshCaps({ allowedTestingTypes: [TestingType.VULN_SCAN] }),
      submissionsCount: 0,
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
      submissionsCount: 0,
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
});
