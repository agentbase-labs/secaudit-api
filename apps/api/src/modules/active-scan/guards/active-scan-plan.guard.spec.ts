import { ExecutionContext } from '@nestjs/common';
import { Repository } from 'typeorm';

import { ActiveScanPlanGuard } from './active-scan-plan.guard';
import type { PlanCapsService } from '../../plans/plan-caps.service';
import type { AppConfigService } from '../../../config/config.service';
import type { ActiveScanJobEntity } from '../entities/active-scan-job.entity';

/**
 * ActiveScanPlanGuard — gate on POST /active-scan/scans (§7.3):
 *   1. global kill-switch (ACTIVE_SCAN_ENABLED)
 *   2. entitlement (activeScansPerMonth !== 0)
 *   3. per-user concurrency (running jobs < activeScanConcurrency)
 */

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function ctx(): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(opts: {
  enabled: boolean;
  caps: { activeScansPerMonth?: number; activeScanConcurrency?: number };
  runningCount: number;
  planId?: string;
}): ActiveScanPlanGuard {
  const capsService = {
    getCaps: jest.fn().mockResolvedValue({
      planId: opts.planId ?? 'pro',
      caps: opts.caps,
    }),
  } as unknown as PlanCapsService;
  const cfg = { activeScanEnabled: opts.enabled } as unknown as AppConfigService;
  const jobs = {
    count: jest.fn().mockResolvedValue(opts.runningCount),
  } as unknown as Repository<ActiveScanJobEntity>;
  return new ActiveScanPlanGuard(capsService, cfg, jobs);
}

describe('ActiveScanPlanGuard', () => {
  it('rejects when the global feature flag is off', async () => {
    const guard = makeGuard({
      enabled: false,
      caps: { activeScansPerMonth: 5, activeScanConcurrency: 1 },
      runningCount: 0,
    });
    await expect(guard.canActivate(ctx())).rejects.toThrow(/disabled/);
  });

  it('rejects entitlement when activeScansPerMonth = 0 (402 + upgrade hint)', async () => {
    const guard = makeGuard({
      enabled: true,
      planId: 'starter',
      caps: { activeScansPerMonth: 0, activeScanConcurrency: 0 },
      runningCount: 0,
    });
    await expect(guard.canActivate(ctx())).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({
        code: 'PLAN_CAP_EXCEEDED',
        cap: 'ACTIVE_SCANS_PER_MONTH',
        suggestUpgradeTo: 'pro',
      }),
    });
  });

  it('rejects when concurrency cap is reached', async () => {
    const guard = makeGuard({
      enabled: true,
      caps: { activeScansPerMonth: 5, activeScanConcurrency: 1 },
      runningCount: 1,
    });
    await expect(guard.canActivate(ctx())).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({ cap: 'ACTIVE_SCAN_CONCURRENCY' }),
    });
  });

  it('allows when entitled, under concurrency, flag on', async () => {
    const guard = makeGuard({
      enabled: true,
      caps: { activeScansPerMonth: 5, activeScanConcurrency: 2 },
      runningCount: 1,
    });
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
  });

  it('allows unlimited concurrency (-1) regardless of running count', async () => {
    const guard = makeGuard({
      enabled: true,
      caps: { activeScansPerMonth: -1, activeScanConcurrency: -1 },
      runningCount: 99,
    });
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
  });
});
