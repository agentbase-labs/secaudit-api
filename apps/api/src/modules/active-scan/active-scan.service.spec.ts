import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

import { ActiveScanService } from './active-scan.service';
import { ActiveScanJobEntity } from './entities/active-scan-job.entity';
import { ActiveScanFindingEntity } from './entities/active-scan-finding.entity';
import { VerifiedTargetEntity } from './entities/verified-target.entity';
import { AuditService } from '../audit/audit.service';
import { PlanCapsService } from '../plans/plan-caps.service';
import { AppConfigService } from '../../config/config.service';
import { JOB_QUEUE } from '../queue/queue.types';

/**
 * Service-level unit tests for ActiveScanService focused on the parts that need
 * no live Postgres (mocked repos): worker findings validation / normalization /
 * dedup, the worker-results lifecycle (running → complete), and the
 * "ignore-when-cancelled" guard. SSE events are captured via the live hub.
 *
 * The DB-bound paths (transactional requestScan, atomic claim RETURNING) are
 * documented as integration-tested in e2e (they need a real DB) — here we keep
 * the suite green by mocking the repo surface they touch.
 */

function makeJob(overrides: Partial<ActiveScanJobEntity> = {}): ActiveScanJobEntity {
  return {
    id: 'job-1',
    userId: 'user-1',
    targetId: 'tgt-1',
    status: 'running',
    verifiedHost: 'example.com',
    verifyTokenSnapshot: 'tok',
    planAtRequest: 'pro',
    profile: 'saas',
    scope: { allowlistHosts: ['example.com'], maxHosts: 4, modules: [], ports: 'default', rate: 300, onlyLowNoise: false },
    workerId: 'w1',
    progressPct: 0,
    currentPhase: null,
    queuedAt: new Date(),
    startedAt: new Date(Date.now() - 1000),
    completedAt: null,
    durationMs: null,
    findingCounts: null,
    summary: null,
    errorReason: null,
    errorLog: null,
    authorizationAccepted: true,
    authorizationVersion: null,
    requestIp: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ActiveScanJobEntity;
}

interface Mocks {
  service: ActiveScanService;
  findingsRepo: { query: jest.Mock; find: jest.Mock; findOne: jest.Mock };
  jobsRepo: { findOne: jest.Mock; save: jest.Mock; query: jest.Mock };
}

async function build(job: ActiveScanJobEntity | null): Promise<Mocks> {
  const findingsRepo = {
    query: jest.fn().mockResolvedValue([]),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const jobsRepo = {
    findOne: jest.fn().mockResolvedValue(job),
    save: jest.fn().mockImplementation(async (j) => j),
    query: jest.fn().mockResolvedValue([{ id: job?.id }]),
  };
  const targetsRepo = { findOne: jest.fn().mockResolvedValue(null) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ActiveScanService,
      { provide: getRepositoryToken(VerifiedTargetEntity), useValue: targetsRepo },
      { provide: getRepositoryToken(ActiveScanJobEntity), useValue: jobsRepo },
      { provide: getRepositoryToken(ActiveScanFindingEntity), useValue: findingsRepo },
      { provide: DataSource, useValue: { transaction: jest.fn() } },
      { provide: PlanCapsService, useValue: { getCaps: jest.fn(), atomicIncrementActiveScanAndCheck: jest.fn() } },
      { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
      {
        provide: AppConfigService,
        useValue: { activeScanEnabled: true, activeScanVerifyTtlDays: 90, get: () => 'false' },
      },
      { provide: JOB_QUEUE, useValue: { enqueue: jest.fn(), cancel: jest.fn() } },
    ],
  }).compile();

  return {
    service: moduleRef.get(ActiveScanService),
    findingsRepo: findingsRepo as unknown as Mocks['findingsRepo'],
    jobsRepo: jobsRepo as unknown as Mocks['jobsRepo'],
  };
}

describe('ActiveScanService.workerFindings', () => {
  it('persists a valid finding, recomputes the dedupKey, and sanitizes ref URLs', async () => {
    const { service, findingsRepo } = await build(makeJob());

    const res = await service.workerFindings('job-1', [
      {
        host: '93.184.216.34',
        port: 445,
        service: 'smb',
        check: 'smb-signing-disabled',
        source: 'module:smb',
        severity: 'medium',
        title: 'SMB signing not required',
        referenceUrls: ['https://ok.example', 'javascript:alert(1)', 'ftp://nope'],
        evidence: { tool: 'nxc', raw: 'signing:False' },
      } as never,
    ]);

    expect(res.persisted).toBe(1);
    expect(res.skipped).toBe(0);
    expect(findingsRepo.query).toHaveBeenCalledTimes(1);
    const params = findingsRepo.query.mock.calls[0]![1] as unknown[];
    // recomputed dedupKey = sha1(host|port|source|check)
    const expectedKey = crypto
      .createHash('sha1')
      .update('93.184.216.34|445|module:smb|smb-signing-disabled')
      .digest('hex');
    expect(params[1]).toBe(expectedKey);
    // referenceUrls (param index 12) keeps only http(s)
    expect(params[12]).toEqual(['https://ok.example']);
  });

  it('coerces unknown severities to info', async () => {
    const { service, findingsRepo } = await build(makeJob());
    await service.workerFindings('job-1', [
      { host: 'h', check: 'c', source: 's', severity: 'spicy', title: 't' } as never,
    ]);
    const params = findingsRepo.query.mock.calls[0]![1] as unknown[];
    // severity is param index 6
    expect(params[6]).toBe('info');
  });

  it('skips malformed findings (missing host/check/source)', async () => {
    const { service, findingsRepo } = await build(makeJob());
    const res = await service.workerFindings('job-1', [
      { port: 1, severity: 'low', title: 'x' } as never, // no host/check/source
      { host: 'h', check: 'c', source: 's', severity: 'low', title: 'ok' } as never,
    ]);
    expect(res.persisted).toBe(1);
    expect(res.skipped).toBe(1);
    expect(findingsRepo.query).toHaveBeenCalledTimes(1);
  });

  it('does not persist when the job is cancelled', async () => {
    const { service, findingsRepo } = await build(makeJob({ status: 'cancelled' }));
    const res = await service.workerFindings('job-1', [
      { host: 'h', check: 'c', source: 's', severity: 'low', title: 'ok' } as never,
    ]);
    expect(res.persisted).toBe(0);
    expect(findingsRepo.query).not.toHaveBeenCalled();
  });
});

describe('ActiveScanService.workerComplete', () => {
  it('finalizes a completed job, recomputes counts, and sets duration', async () => {
    const job = makeJob();
    const { service, jobsRepo, findingsRepo } = await build(job);
    findingsRepo.query.mockResolvedValueOnce([
      { severity: 'high', c: 2 },
      { severity: 'low', c: 1 },
    ]);

    await service.workerComplete('job-1', 'completed', null, null, null, null);

    expect(jobsRepo.save).toHaveBeenCalled();
    const saved = jobsRepo.save.mock.calls.at(-1)![0] as ActiveScanJobEntity;
    expect(saved.status).toBe('completed');
    expect(saved.progressPct).toBe(100);
    expect(saved.durationMs).toBeGreaterThanOrEqual(0);
    expect(saved.findingCounts).toMatchObject({ high: 2, low: 1, total: 3 });
  });

  it('ignores completion for a cancelled job', async () => {
    const { service, jobsRepo } = await build(makeJob({ status: 'cancelled' }));
    await service.workerComplete('job-1', 'completed', null, null, null, null);
    expect(jobsRepo.save).not.toHaveBeenCalled();
  });
});

describe('ActiveScanService.workerClaim', () => {
  it('atomically claims a queued job (UPDATE … WHERE status=queued RETURNING)', async () => {
    const job = makeJob({ status: 'running' }); // post-claim state
    const { service, jobsRepo } = await build(job);
    const targetSpy = jest.fn().mockResolvedValue({ verifiedMethod: 'dns_txt' });
    (service as unknown as { targets: { findOne: jest.Mock } }).targets.findOne = targetSpy;

    const res = await service.workerClaim('job-1', 'worker-A');

    expect(jobsRepo.query).toHaveBeenCalled();
    const sql = jobsRepo.query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/UPDATE "active_scan_jobs"/);
    expect(sql).toMatch(/WHERE "id" = \$1 AND "status" = 'queued'/);
    expect(sql).toMatch(/RETURNING "id"/);
    expect(res).toMatchObject({
      jobId: 'job-1',
      verifiedHost: 'example.com',
      verifyTokenSnapshot: 'tok',
      verifiedMethod: 'dns_txt',
    });
  });
});
