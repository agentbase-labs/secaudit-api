import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionStatus } from '@cs-platform/shared';

import { PlanCapsService } from './plan-caps.service';
import { Subscription } from './entities/subscription.entity';

/**
 * Spec: every seed plan (starter/pro/business/enterprise) yields the
 * caps that doc 02 \u00a71 specifies. Source-of-truth crosscheck.
 */

interface SeedSpec {
  planId: string;
  submissionsPerMonth: number;
  registeredAssetsMax: number;
  manualPentestsPerYear: number;
  mobileUploadMaxMb: number;
  retentionDays: number;
  redTeamEnabled: boolean;
  ssoEnabled: boolean;
  allowedTestingTypesIncludes: string[];
}

// EXACT mirror of `1740000000000-plans-and-subscriptions.ts` seed.
// If this drifts from the migration, the migration is wrong (or this test is).
const SEEDS: Record<string, SeedSpec> = {
  starter: {
    planId: 'starter',
    submissionsPerMonth: 3,
    registeredAssetsMax: 2,
    manualPentestsPerYear: 0,
    mobileUploadMaxMb: 0,
    retentionDays: 90,
    redTeamEnabled: false,
    ssoEnabled: false,
    allowedTestingTypesIncludes: ['vuln_scan', 'api_test'],
  },
  pro: {
    planId: 'pro',
    submissionsPerMonth: 10,
    registeredAssetsMax: 8,
    manualPentestsPerYear: 0,
    mobileUploadMaxMb: 200,
    retentionDays: 365,
    redTeamEnabled: false,
    ssoEnabled: false,
    allowedTestingTypesIncludes: ['vuln_scan', 'api_test', 'source_review'],
  },
  business: {
    planId: 'business',
    submissionsPerMonth: 30,
    registeredAssetsMax: 25,
    manualPentestsPerYear: 1,
    mobileUploadMaxMb: 500,
    retentionDays: 1095,
    redTeamEnabled: false,
    ssoEnabled: false,
    allowedTestingTypesIncludes: ['vuln_scan', 'api_test', 'source_review', 'manual_pentest'],
  },
  enterprise: {
    planId: 'enterprise',
    submissionsPerMonth: 100,
    registeredAssetsMax: -1,
    manualPentestsPerYear: -1,
    mobileUploadMaxMb: 2048,
    retentionDays: 2555,
    redTeamEnabled: true,
    ssoEnabled: true,
    allowedTestingTypesIncludes: ['red_team'],
  },
};

function buildCaps(spec: SeedSpec) {
  return {
    submissionsPerMonth: spec.submissionsPerMonth,
    registeredAssetsMax: spec.registeredAssetsMax,
    manualPentestsPerYear: spec.manualPentestsPerYear,
    mobileUploadMaxMb: spec.mobileUploadMaxMb,
    seatsMax: 1,
    retentionDays: spec.retentionDays,
    perTypeSubmissionsPerMonth: null,
    allowedAssetTypes: ['website'],
    allowedTestingTypes: spec.allowedTestingTypesIncludes,
    redTeamEnabled: spec.redTeamEnabled,
    ssoEnabled: spec.ssoEnabled,
    complianceReportEnabled: false,
    auditLogAccess: false,
    retestsPerRequest: null,
    slaVulnBusinessDays: null,
    slaPentestBusinessDays: null,
    supportTier: 'community',
  };
}

describe('PlanCapsService.getCaps', () => {
  const userId = '11111111-1111-1111-1111-111111111111';

  async function makeService(planSpec: SeedSpec): Promise<PlanCapsService> {
    const fakeSub = {
      id: 'sub-1',
      userId,
      planId: planSpec.planId,
      status: SubscriptionStatus.ACTIVE,
      plan: {
        id: planSpec.planId,
        name: planSpec.planId,
        caps: buildCaps(planSpec),
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

    // REQUEST scope -> resolve a fresh instance.
    return moduleRef.resolve(PlanCapsService);
  }

  it.each(Object.values(SEEDS))(
    'returns the correct caps for plan=$planId',
    async (spec) => {
      const svc = await makeService(spec);
      const result = await svc.getCaps(userId);

      expect(result.planId).toBe(spec.planId);
      expect(result.caps.submissionsPerMonth).toBe(spec.submissionsPerMonth);
      expect(result.caps.registeredAssetsMax).toBe(spec.registeredAssetsMax);
      expect(result.caps.manualPentestsPerYear).toBe(spec.manualPentestsPerYear);
      expect(result.caps.mobileUploadMaxMb).toBe(spec.mobileUploadMaxMb);
      expect(result.caps.retentionDays).toBe(spec.retentionDays);
      expect(result.caps.redTeamEnabled).toBe(spec.redTeamEnabled);
      expect(result.caps.ssoEnabled).toBe(spec.ssoEnabled);
      for (const t of spec.allowedTestingTypesIncludes) {
        expect(result.caps.allowedTestingTypes).toContain(t);
      }
    },
  );

  it('memoizes within the same request (single DB call)', async () => {
    const svc = await makeService(SEEDS.starter!);
    const repo = (svc as unknown as { subs: Repository<Subscription> }).subs;
    const findSpy = jest.spyOn(repo, 'findOne');

    await svc.getCaps(userId);
    await svc.getCaps(userId);

    // Only the first call should hit the repo (REQUEST-scoped cache).
    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  it('throws InternalServerError if the user has no active subscription', async () => {
    const repoMock: Partial<Repository<Subscription>> = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlanCapsService,
        { provide: getRepositoryToken(Subscription), useValue: repoMock },
      ],
    }).compile();
    const svc = await moduleRef.resolve(PlanCapsService);
    await expect(svc.getCaps(userId)).rejects.toMatchObject({
      status: 500,
    });
  });
});
