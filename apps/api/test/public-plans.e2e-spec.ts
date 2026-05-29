/**
 * E2E for `GET /api/v1/public/plans`.
 *
 * Strategy: stand up the full PlansController + PlansService through
 * Nest's testing harness, mock only the TypeORM repository at the edge,
 * and assert on the HTTP-style response shape the controller would emit
 * (this is the same JSON the marketing site consumes).
 */

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PlansController } from '../src/modules/plans/plans.controller';
import { PlansService } from '../src/modules/plans/plans.service';
import { Plan } from '../src/modules/plans/entities/plan.entity';

const REQUIRED_CAP_KEYS = [
  'submissionsPerMonth',
  'registeredAssetsMax',
  'manualPentestsPerYear',
  'mobileUploadMaxMb',
  'seatsMax',
  'retentionDays',
  'allowedAssetTypes',
  'allowedTestingTypes',
  'redTeamEnabled',
  'ssoEnabled',
  'complianceReportEnabled',
  'auditLogAccess',
  'retestsPerRequest',
  'supportTier',
];

const SEED_PLANS: Partial<Plan>[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthlyPriceUsdCents: 4900,
    annualPriceUsdCents: 49900,
    isPublic: true,
    sortOrder: 20,
    caps: capsFor({ submissionsPerMonth: 3, registeredAssetsMax: 2, retentionDays: 90 }),
  } as Plan,
  {
    id: 'pro',
    name: 'Pro',
    monthlyPriceUsdCents: 17900,
    annualPriceUsdCents: 179900,
    isPublic: true,
    sortOrder: 30,
    caps: capsFor({ submissionsPerMonth: 10, registeredAssetsMax: 8, retentionDays: 365 }),
  } as Plan,
  {
    id: 'business',
    name: 'Business',
    monthlyPriceUsdCents: 59900,
    annualPriceUsdCents: 599900,
    isPublic: true,
    sortOrder: 40,
    caps: capsFor({ submissionsPerMonth: 30, registeredAssetsMax: 25, retentionDays: 1095 }),
  } as Plan,
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPriceUsdCents: 0,
    annualPriceUsdCents: 0,
    isPublic: true,
    sortOrder: 50,
    caps: capsFor({
      submissionsPerMonth: 100,
      registeredAssetsMax: -1,
      retentionDays: 2555,
      ssoEnabled: true,
      redTeamEnabled: true,
    }),
  } as Plan,
];

function capsFor(overrides: Record<string, unknown>) {
  return {
    submissionsPerMonth: 0,
    registeredAssetsMax: 0,
    manualPentestsPerYear: 0,
    mobileUploadMaxMb: 0,
    seatsMax: 1,
    retentionDays: 0,
    perTypeSubmissionsPerMonth: null,
    allowedAssetTypes: ['website'],
    allowedTestingTypes: ['vuln_scan'],
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

describe('GET /public/plans (e2e)', () => {
  let controller: PlansController;

  beforeAll(async () => {
    const repoMock = {
      find: jest.fn().mockResolvedValue(SEED_PLANS),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        PlansService,
        { provide: getRepositoryToken(Plan), useValue: repoMock },
      ],
    }).compile();
    controller = moduleRef.get(PlansController);
  });

  it('returns exactly the 4 product tiers', async () => {
    const body = await controller.listPublic();
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans).toHaveLength(4);
    expect(body.plans.map((p) => p.id)).toEqual([
      'starter',
      'pro',
      'business',
      'enterprise',
    ]);
  });

  it('every plan has the canonical PublicPlan shape', async () => {
    const body = await controller.listPublic();
    for (const plan of body.plans) {
      expect(plan).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          monthlyPriceUsdCents: expect.any(Number),
          annualPriceUsdCents: expect.any(Number),
          isPublic: true,
          sortOrder: expect.any(Number),
        }),
      );
      // Caps shape — every required field must be present.
      for (const key of REQUIRED_CAP_KEYS) {
        expect(plan.caps).toHaveProperty(key);
      }
      expect(Array.isArray(plan.caps.allowedAssetTypes)).toBe(true);
      expect(Array.isArray(plan.caps.allowedTestingTypes)).toBe(true);
    }
  });

  it('prices are integer cents (not dollars)', async () => {
    const body = await controller.listPublic();
    const pro = body.plans.find((p) => p.id === 'pro')!;
    expect(pro.monthlyPriceUsdCents).toBe(17900);
    expect(pro.annualPriceUsdCents).toBe(179900);
    const biz = body.plans.find((p) => p.id === 'business')!;
    expect(biz.monthlyPriceUsdCents).toBe(59900);
    expect(biz.annualPriceUsdCents).toBe(599900);
  });
});
