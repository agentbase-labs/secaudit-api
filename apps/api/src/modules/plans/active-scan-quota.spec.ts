import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SubscriptionStatus } from '@cs-platform/shared';

import { PlanCapsService } from './plan-caps.service';
import { Subscription } from './entities/subscription.entity';

/**
 * Unit tests for `PlanCapsService.atomicIncrementActiveScanAndCheck` — the
 * active-scan monthly-quota counter that closes the TOCTOU race the same way
 * submissions do (ACTIVE_SCAN_DESIGN.md §7.3).
 *
 * No real Postgres available (see PROGRESS / jest-setup) — we mock
 * EntityManager.query and assert the SQL shape + post-increment cap semantics.
 */

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeCaps(activeScansPerMonth: number) {
  return {
    submissionsPerMonth: 100,
    registeredAssetsMax: -1,
    manualPentestsPerYear: -1,
    mobileUploadMaxMb: 0,
    seatsMax: 1,
    retentionDays: 30,
    perTypeSubmissionsPerMonth: null,
    activeScansPerMonth,
    activeScanConcurrency: 2,
    activeScanMaxTargets: 25,
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
  };
}

async function buildService(activeScansPerMonth: number, planId = 'pro'): Promise<PlanCapsService> {
  const fakeSub = {
    id: 'sub-1',
    userId,
    planId,
    status: SubscriptionStatus.ACTIVE,
    plan: { id: planId, name: planId, caps: makeCaps(activeScansPerMonth) },
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

function fakeManager(activeScansCount: number): { manager: EntityManager; query: jest.Mock } {
  const query = jest.fn().mockResolvedValue([{ activeScansCount }]);
  return { manager: { query } as unknown as EntityManager, query };
}

describe('PlanCapsService.atomicIncrementActiveScanAndCheck', () => {
  it('emits an UPSERT on usage_counters.activeScansCount with RETURNING', async () => {
    const svc = await buildService(5);
    const { manager, query } = fakeManager(1);

    await svc.atomicIncrementActiveScanAndCheck(manager, userId, true);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO usage_counters/i);
    expect(sql).toMatch(/ON CONFLICT \("userId", "periodStart"\)/i);
    expect(sql).toMatch(/"activeScansCount" = usage_counters\."activeScansCount" \+ 1/);
    expect(sql).toMatch(/RETURNING "activeScansCount"/);
    expect(params).toHaveLength(2);
    expect(params[0]).toBe(userId);
    expect((params[1] as Date).getUTCDate()).toBe(1); // start of UTC month
  });

  it('throws ACTIVE_SCANS_PER_MONTH (402) when post-increment exceeds the cap', async () => {
    const svc = await buildService(1);
    const { manager } = fakeManager(2); // second concurrent caller saw 1 → 2

    await expect(
      svc.atomicIncrementActiveScanAndCheck(manager, userId, true),
    ).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({
        code: 'PLAN_CAP_EXCEEDED',
        cap: 'ACTIVE_SCANS_PER_MONTH',
        max: 1,
        suggestUpgradeTo: 'business',
      }),
    });
  });

  it('passes at the boundary (post-increment === cap)', async () => {
    const svc = await buildService(5);
    const { manager } = fakeManager(5);
    await expect(
      svc.atomicIncrementActiveScanAndCheck(manager, userId, true),
    ).resolves.toBeUndefined();
  });

  it('treats activeScansPerMonth=0 as disabled (throws even on first scan)', async () => {
    const svc = await buildService(0, 'starter');
    const { manager } = fakeManager(1);
    await expect(
      svc.atomicIncrementActiveScanAndCheck(manager, userId, true),
    ).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({ cap: 'ACTIVE_SCANS_PER_MONTH' }),
    });
  });

  it('skips the cap check when activeScansPerMonth = -1 (unlimited)', async () => {
    const svc = await buildService(-1, 'enterprise');
    const { manager } = fakeManager(9999);
    await expect(
      svc.atomicIncrementActiveScanAndCheck(manager, userId, true),
    ).resolves.toBeUndefined();
  });

  it('enforced=false still increments (display accuracy) but never throws', async () => {
    const svc = await buildService(1);
    const { manager, query } = fakeManager(9999);
    await expect(
      svc.atomicIncrementActiveScanAndCheck(manager, userId, false),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
