/**
 * Concurrency e2e for the TOCTOU hardening on submissions counter.
 *
 * Goal: 5 simultaneous `POST /requests` for a Free user (cap=1) must
 * resolve to exactly 1 success and 4 PLAN_CAP_EXCEEDED 402s.
 *
 * Why this is not a real Postgres test:
 *   The CI/local test infra here does not have a Postgres reachable
 *   (see `apps/api/test/jest-setup.ts` — pure unit harness, no DB
 *   container, no testcontainers, no migrations applied). The unit
 *   spec `src/modules/plans/atomic-counter.spec.ts` covers the SQL
 *   shape; this file covers the *concurrency contract* by simulating
 *   the row-lock semantics of `INSERT … ON CONFLICT DO UPDATE
 *   RETURNING` with an in-process serialized counter. If/when real
 *   pg-backed e2e infra lands, this can be repointed at a live DB
 *   without changing the assertions.
 *
 * The simulation is faithful to the real DB behavior:
 *   - The atomic UPSERT is the only path that mutates the counter.
 *   - We serialize concurrent SQL calls per-userId (mirrors row lock).
 *   - Each call gets back its own post-increment RETURNING value.
 *   - The service compares RETURNING > cap and throws on overshoot.
 *   - Caller's transaction rollback "reverts" the counter — the sim
 *     decrements on rejection to model that.
 */

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AssetType,
  Environment,
  SubscriptionStatus,
  TestingType,
  UserRole,
} from '@cs-platform/shared';

import { RequestsService } from '../src/modules/requests/requests.service';
import { TestingRequest } from '../src/modules/requests/entities/testing-request.entity';
import { Report } from '../src/modules/reports/entities/report.entity';
import { Subscription } from '../src/modules/plans/entities/subscription.entity';
import { PlanCapsService } from '../src/modules/plans/plan-caps.service';
import { AppConfigService } from '../src/config/config.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AutoScanService } from '../src/modules/auto-scan/auto-scan.service';
import { STORAGE_SERVICE } from '../src/modules/storage/storage.service';
import { CRYPTO_SERVICE } from '../src/modules/crypto/crypto.service';
import { MAIL_SERVICE } from '../src/modules/mail/mail.service';

const userId = '11111111-1111-1111-1111-111111111111';

/**
 * Simulated row-locked usage_counter.
 *
 * Models the real-DB atomic UPSERT:
 *   - One Promise chain per (userId, periodStart) → calls serialize
 *     just like a row lock.
 *   - `incrementAndReturning(testingType)` returns the post-increment
 *     row, atomically.
 *   - `revertSubmission()` simulates the caller's tx rollback when
 *     they throw on cap-exceeded.
 */
class FakeAtomicCounter {
  private chain: Promise<unknown> = Promise.resolve();
  private state = {
    submissionsCount: 0,
    sourceReviewsCount: 0,
    manualPentestsCountYtd: 0,
  };

  async incrementAndReturning(testingType: TestingType): Promise<{
    submissionsCount: number;
    sourceReviewsCount: number;
    manualPentestsCountYtd: number;
  }> {
    const next = this.chain.then(() => {
      this.state.submissionsCount += 1;
      if (testingType === TestingType.SOURCE_REVIEW) this.state.sourceReviewsCount += 1;
      if (testingType === TestingType.MANUAL_PENTEST) this.state.manualPentestsCountYtd += 1;
      return { ...this.state };
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Models the rollback path: one decrement, mirroring the failed insert. */
  revertSubmission(testingType: TestingType): void {
    this.state.submissionsCount = Math.max(0, this.state.submissionsCount - 1);
    if (testingType === TestingType.SOURCE_REVIEW) {
      this.state.sourceReviewsCount = Math.max(0, this.state.sourceReviewsCount - 1);
    }
    if (testingType === TestingType.MANUAL_PENTEST) {
      this.state.manualPentestsCountYtd = Math.max(0, this.state.manualPentestsCountYtd - 1);
    }
  }

  snapshot() {
    return { ...this.state };
  }
}

describe('POST /requests — TOCTOU concurrency hardening (e2e simulation)', () => {
  // 5 concurrent submissions for a Free user (cap=1) → exactly 1 wins.
  const FREE_CAPS = {
    submissionsPerMonth: 1,
    registeredAssetsMax: -1,
    manualPentestsPerYear: 0,
    mobileUploadMaxMb: 0,
    seatsMax: 1,
    retentionDays: 30,
    perTypeSubmissionsPerMonth: null,
    allowedAssetTypes: [AssetType.WEBSITE],
    allowedTestingTypes: [TestingType.VULN_SCAN],
    redTeamEnabled: false,
    ssoEnabled: false,
    complianceReportEnabled: false,
    auditLogAccess: false,
    retestsPerRequest: null,
    slaVulnBusinessDays: null,
    slaPentestBusinessDays: null,
    supportTier: 'community',
  };

  async function buildSubject() {
    const counter = new FakeAtomicCounter();
    let inserted = 0;
    let revertedTransactions = 0;

    // DataSource.transaction wrapper: builds a fresh fake EntityManager
    // per tx, tracks which testingType was attempted, and on throw
    // reverts the counter (mirroring real Postgres tx rollback).
    const dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (m: EntityManager) => Promise<unknown>) => {
        let attemptedType: TestingType | null = null;
        const fakeManager = {
          query: jest.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
            attemptedType = params[2] as TestingType;
            const row = await counter.incrementAndReturning(attemptedType);
            return [row];
          }),
          create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
            ...data,
            id: `tr-${++inserted}`,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
          save: jest.fn(async (entity: { id: string }) => entity),
        } as unknown as EntityManager;
        try {
          return await cb(fakeManager);
        } catch (e) {
          if (attemptedType) {
            counter.revertSubmission(attemptedType);
            revertedTransactions++;
          }
          throw e;
        }
      }),
    } as unknown as DataSource;

    const subscriptionRepoMock: Partial<Repository<Subscription>> = {
      findOne: jest.fn().mockResolvedValue({
        id: 'sub-1',
        userId,
        planId: 'free',
        status: SubscriptionStatus.ACTIVE,
        plan: { id: 'free', name: 'Free', caps: FREE_CAPS },
      }),
    };

    const cfg = {
      get: (key: string) => {
        if (key === 'PLAN_CAPS_ENFORCED') return 'true'; // env override for this test
        if (key === 'APP_URL') return 'http://test.local';
        if (key === 'FEATURES_AUTOSCAN') return false;
        return undefined;
      },
    } as unknown as AppConfigService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestsService,
        PlanCapsService,
        { provide: getRepositoryToken(Subscription), useValue: subscriptionRepoMock },
        { provide: getRepositoryToken(TestingRequest), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(Report), useValue: { find: jest.fn() } },
        { provide: AppConfigService, useValue: cfg },
        { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
        { provide: AutoScanService, useValue: { runScan: jest.fn().mockResolvedValue(undefined) } },
        { provide: STORAGE_SERVICE, useValue: {} },
        { provide: CRYPTO_SERVICE, useValue: { encrypt: jest.fn(), decrypt: jest.fn() } },
        { provide: MAIL_SERVICE, useValue: { sendTemplate: jest.fn().mockResolvedValue(undefined) } },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    const svc = await moduleRef.resolve(RequestsService);
    return { svc, counter, getRevertedTransactions: () => revertedTransactions };
  }

  it('5 concurrent submissions on Free plan (cap=1) → exactly 1 success + 4 PLAN_CAP_EXCEEDED', async () => {
    const { svc, counter, getRevertedTransactions } = await buildSubject();

    const publicUser = {
      id: userId,
      email: 't@example.com',
      fullName: 'T',
      companyName: null,
      role: UserRole.CLIENT,
      emailVerified: true,
      disabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const dto = {
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      details: { url: 'https://x.example', env: Environment.PROD },
    };

    // Fire 5 in parallel. Promise.allSettled so we don't bail on first throw.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => svc.create(publicUser, dto, null)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    // Every rejection must be the structured 402.
    for (const r of rejected) {
      expect(r.reason).toMatchObject({
        status: 402,
        response: expect.objectContaining({
          code: 'PLAN_CAP_EXCEEDED',
          cap: 'SUBMISSIONS_PER_MONTH',
        }),
      });
    }

    // 4 transactions rolled back.
    expect(getRevertedTransactions()).toBe(4);

    // Final counter state: exactly 1 (TOCTOU window closed).
    expect(counter.snapshot().submissionsCount).toBe(1);
  });

  it('honors PLAN_CAPS_ENFORCED=false: all 5 succeed even past cap (kill-switch)', async () => {
    // Build a separate subject with the env flag flipped off.
    const counter = new FakeAtomicCounter();
    let inserted = 0;

    const fakeManager = {
      query: jest.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
        const row = await counter.incrementAndReturning(params[2] as TestingType);
        return [row];
      }),
      create: jest.fn((_e: unknown, d: Record<string, unknown>) => ({
        ...d,
        id: `tr-${++inserted}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn(async (e: { id: string }) => e),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (m: EntityManager) => Promise<unknown>) =>
        cb(fakeManager),
      ),
    } as unknown as DataSource;

    const subscriptionRepoMock: Partial<Repository<Subscription>> = {
      findOne: jest.fn().mockResolvedValue({
        id: 'sub-1',
        userId,
        planId: 'free',
        status: SubscriptionStatus.ACTIVE,
        plan: { id: 'free', name: 'Free', caps: FREE_CAPS },
      }),
    };

    const cfg = {
      get: (key: string) => {
        if (key === 'PLAN_CAPS_ENFORCED') return 'false'; // KILL-SWITCH OFF
        if (key === 'APP_URL') return 'http://test.local';
        if (key === 'FEATURES_AUTOSCAN') return false;
        return undefined;
      },
    } as unknown as AppConfigService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestsService,
        PlanCapsService,
        { provide: getRepositoryToken(Subscription), useValue: subscriptionRepoMock },
        { provide: getRepositoryToken(TestingRequest), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(Report), useValue: { find: jest.fn() } },
        { provide: AppConfigService, useValue: cfg },
        { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
        { provide: AutoScanService, useValue: { runScan: jest.fn().mockResolvedValue(undefined) } },
        { provide: STORAGE_SERVICE, useValue: {} },
        { provide: CRYPTO_SERVICE, useValue: { encrypt: jest.fn(), decrypt: jest.fn() } },
        { provide: MAIL_SERVICE, useValue: { sendTemplate: jest.fn().mockResolvedValue(undefined) } },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    const svc = await moduleRef.resolve(RequestsService);
    const publicUser = {
      id: userId,
      email: 't@example.com',
      fullName: 'T',
      companyName: null,
      role: UserRole.CLIENT,
      emailVerified: true,
      disabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const dto = {
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      details: { url: 'https://x.example', env: Environment.PROD },
    };

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => svc.create(publicUser, dto, null)),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // Counter still increments (display cache stays accurate even when
    // enforcement is off).
    expect(counter.snapshot().submissionsCount).toBe(5);
  });
});
