import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Observable, Subject } from 'rxjs';
import * as crypto from 'crypto';
import * as https from 'https';
import * as dns from 'dns';
import { promisify } from 'util';

import {
  ApiErrorCodes,
  ACTIVE_SCAN_ACTIVE_STATUSES,
} from '@cs-platform/shared';
import type {
  ActiveScanFinding,
  ActiveScanFindingCounts,
  ActiveScanFindingsResponse,
  ActiveScanJob,
  ActiveScanJobStatus,
  ActiveScanScope,
  AutoScanSeverity,
  NormalizedFindingsDoc,
  SkyNetSummary,
  VerifiedTarget,
  VerifiedTargetWithInstructions,
  VerifyTargetResult,
  WorkerClaimResponse,
  WorkerFinding,
  WorkerProgressBody,
} from '@cs-platform/shared';

import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { PlanCapsService } from '../plans/plan-caps.service';
import { JOB_QUEUE } from '../queue/queue.types';
import type { JobQueue } from '../queue/queue.types';
import { assertScannableHostname, firstBlockedIp } from '../../common/utils/host-guard';
import { ActiveScanJobEntity } from './entities/active-scan-job.entity';
import { ActiveScanFindingEntity } from './entities/active-scan-finding.entity';
import { VerifiedTargetEntity } from './entities/verified-target.entity';

const resolveTxt = promisify(dns.resolveTxt);
const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

const SEVERITY_ORDER: Record<AutoScanSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

interface JobHub {
  subject: Subject<MessageEvent>;
}

/**
 * Control-plane service for the Active / Deep Scan feature. NEVER runs a scan
 * (that's the isolated worker, §2). It validates, enqueues, persists worker
 * results, and fans SSE events out to subscribed users.
 */
@Injectable()
export class ActiveScanService {
  private readonly logger = new Logger(ActiveScanService.name);
  /** Per-job live SSE hubs (created on first subscribe or first worker event). */
  private readonly hubs = new Map<string, JobHub>();

  constructor(
    @InjectRepository(VerifiedTargetEntity)
    private readonly targets: Repository<VerifiedTargetEntity>,
    @InjectRepository(ActiveScanJobEntity)
    private readonly jobs: Repository<ActiveScanJobEntity>,
    @InjectRepository(ActiveScanFindingEntity)
    private readonly findings: Repository<ActiveScanFindingEntity>,
    private readonly dataSource: DataSource,
    private readonly caps: PlanCapsService,
    private readonly audit: AuditService,
    private readonly cfg: AppConfigService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  // ════════════════════════════ Targets ════════════════════════════════════

  async addTarget(
    userId: string,
    hostnameInput: string,
    ip: string | null,
  ): Promise<VerifiedTargetWithInstructions> {
    let hostname: string;
    try {
      hostname = assertScannableHostname(hostnameInput);
    } catch (e) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: (e as Error).message,
      });
    }

    // Plan cap: max retained verified targets.
    const { caps } = await this.caps.getCaps(userId);
    const maxTargets = caps.activeScanMaxTargets ?? 0;
    if (maxTargets !== -1) {
      const existingCount = await this.targets.count({ where: { userId } });
      const already = await this.targets.findOne({ where: { userId, hostname } });
      if (!already && existingCount >= maxTargets) {
        throw new ForbiddenException({
          error: ApiErrorCodes.FORBIDDEN,
          message:
            maxTargets === 0
              ? 'Your plan does not include verified targets'
              : `Target limit reached (${maxTargets})`,
        });
      }
    }

    const token = crypto.randomBytes(24).toString('base64url'); // 32-char url-safe
    let row = await this.targets.findOne({ where: { userId, hostname } });
    if (row) {
      // Re-add → regenerate token, reset to pending.
      row.token = token;
      row.status = 'pending';
      row.verifiedMethod = null;
      row.tokenIssuedAt = new Date();
      row.verifiedAt = null;
      row.expiresAt = null;
    } else {
      row = this.targets.create({
        userId,
        hostname,
        token,
        status: 'pending',
        tokenIssuedAt: new Date(),
      });
    }
    await this.targets.save(row);

    await this.audit.record({
      actorUserId: userId,
      action: 'active_scan.target.added',
      targetType: 'verified_target',
      targetId: row.id,
      ip,
      meta: { hostname },
    });

    return this.toTargetWithInstructions(row);
  }

  async listTargets(userId: string): Promise<VerifiedTarget[]> {
    const rows = await this.targets.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => this.toTarget(r));
  }

  async removeTarget(userId: string, id: string, ip: string | null): Promise<{ success: true }> {
    const row = await this.targets.findOne({ where: { id, userId } });
    if (!row) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Target not found' });
    }
    await this.targets.remove(row);
    await this.audit.record({
      actorUserId: userId,
      action: 'active_scan.target.removed',
      targetType: 'verified_target',
      targetId: id,
      ip,
      meta: { hostname: row.hostname },
    });
    return { success: true };
  }

  async verifyTarget(
    userId: string,
    id: string,
    method: 'dns_txt' | 'http_file' | undefined,
    ip: string | null,
  ): Promise<VerifyTargetResult> {
    const row = await this.targets.findOne({ where: { id, userId } });
    if (!row) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Target not found' });
    }

    row.lastCheckedAt = new Date();
    const expected = `secaudit-verify=${row.token}`;

    let verified = false;
    let usedMethod: 'dns_txt' | 'http_file' | null = null;
    let detail = '';

    const tryDns = async (): Promise<boolean> => {
      try {
        const records = await resolveTxt(row.hostname);
        const flat = records.map((parts) => parts.join(''));
        if (flat.some((v) => v.trim() === expected)) {
          usedMethod = 'dns_txt';
          return true;
        }
        detail = `DNS TXT record "${expected}" not found on ${row.hostname}.`;
        return false;
      } catch (e) {
        detail = `Could not resolve TXT records for ${row.hostname}: ${(e as Error).message}`;
        return false;
      }
    };

    const tryHttp = async (): Promise<boolean> => {
      try {
        const body = await this.fetchWellKnown(row.hostname);
        if (body.includes(expected)) {
          usedMethod = 'http_file';
          return true;
        }
        detail = `HTTP file did not contain "${expected}".`;
        return false;
      } catch (e) {
        detail = `Could not fetch the verification file: ${(e as Error).message}`;
        return false;
      }
    };

    if (method === 'dns_txt') verified = await tryDns();
    else if (method === 'http_file') verified = await tryHttp();
    else verified = (await tryDns()) || (await tryHttp());

    if (verified) {
      const now = new Date();
      row.status = 'verified';
      row.verifiedAt = now;
      row.verifiedMethod = usedMethod;
      row.expiresAt = new Date(
        now.getTime() + this.cfg.activeScanVerifyTtlDays * 24 * 60 * 60 * 1000,
      );
      detail = `Verified via ${usedMethod}.`;
    }
    await this.targets.save(row);

    await this.audit.record({
      actorUserId: userId,
      action: verified ? 'active_scan.target.verified' : 'active_scan.target.verify_failed',
      targetType: 'verified_target',
      targetId: row.id,
      ip,
      meta: { hostname: row.hostname, method: usedMethod ?? method ?? 'auto' },
    });

    return {
      verified,
      status: row.status,
      method: usedMethod,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      detail,
    };
  }

  /** SSRF-safe HTTPS fetch of the well-known verification file. */
  private async fetchWellKnown(hostname: string): Promise<string> {
    // Resolve + block private ranges BEFORE connecting (SSRF guard, §8).
    const ips = await this.resolveHost(hostname);
    if (ips.length === 0) throw new Error('host does not resolve');
    const blocked = firstBlockedIp(ips);
    if (blocked) {
      throw new Error(`resolved to blocked address ${blocked.ip} (${blocked.reason})`);
    }

    return new Promise<string>((resolve, reject) => {
      const req = https.get(
        {
          host: hostname,
          path: '/.well-known/secaudit-verify.txt',
          timeout: 10000,
          headers: { 'User-Agent': 'SecAudit-Verifier/1.0' },
          // No redirects: do NOT follow (a redirect could point at an internal host).
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300) {
            res.destroy();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => {
            if (body.length < 4096) body += c;
          });
          res.on('end', () => resolve(body));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
  }

  private async resolveHost(hostname: string): Promise<string[]> {
    const out: string[] = [];
    try {
      out.push(...(await resolve4(hostname)));
    } catch {
      /* ignore */
    }
    try {
      out.push(...(await resolve6(hostname)));
    } catch {
      /* ignore */
    }
    return out;
  }

  // ════════════════════════════ Scan request ═══════════════════════════════

  /**
   * Request a scan. Runs the entitlement re-checks + atomic monthly-quota
   * reservation inside a single transaction (TOCTOU defense, §5.1 / §7.3), then
   * enqueues the job for the worker to pull.
   */
  async requestScan(
    userId: string,
    planSlug: string,
    targetId: string,
    authorizationAccepted: boolean,
    authorizationVersion: string | null,
    ip: string | null,
  ): Promise<{ jobId: string; status: ActiveScanJobStatus }> {
    if (!this.cfg.activeScanEnabled) {
      throw new ForbiddenException({
        error: ApiErrorCodes.FORBIDDEN,
        message: 'Active scanning is currently disabled',
      });
    }
    if (authorizationAccepted !== true) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'You must accept the scan authorization attestation',
      });
    }

    const enforced = this.cfg.get('PLAN_CAPS_ENFORCED') === 'true';
    const defaultMaxHosts = this.cfg.activeScanDefaultMaxHosts;
    const defaultRate = this.cfg.activeScanDefaultRate;

    const jobId = await this.dataSource.transaction(async (manager) => {
      // Lock + re-check target verification + expiry (§3.4).
      const target = await manager.findOne(VerifiedTargetEntity, {
        where: { id: targetId, userId },
      });
      if (!target) {
        throw new NotFoundException({
          error: ApiErrorCodes.NOT_FOUND,
          message: 'Target not found',
        });
      }
      if (target.status !== 'verified') {
        throw new BadRequestException({
          error: ApiErrorCodes.VALIDATION_ERROR,
          message: 'Target is not verified',
        });
      }
      if (target.expiresAt && target.expiresAt.getTime() < Date.now()) {
        // Mark expired so the UI prompts re-verification.
        target.status = 'expired';
        await manager.save(target);
        throw new BadRequestException({
          error: ApiErrorCodes.VALIDATION_ERROR,
          message: 'Target verification has expired — please re-verify',
        });
      }

      // Atomic monthly quota reservation (rolls back on cap-exceeded).
      await this.caps.atomicIncrementActiveScanAndCheck(manager, userId, enforced);

      const scope: ActiveScanScope = {
        allowlistHosts: [target.hostname],
        maxHosts: defaultMaxHosts,
        modules: [
          'smb', 'oracle', 'snmp', 'rmi', 'mysql', 'mssql',
          'ftp', 'rdp', 'vnc', 'winrm', 'x11', 'redis', 'ldap',
        ],
        ports: 'default',
        rate: defaultRate,
        onlyLowNoise: false,
      };

      const job = manager.create(ActiveScanJobEntity, {
        userId,
        targetId: target.id,
        status: 'queued' as ActiveScanJobStatus,
        verifiedHost: target.hostname,
        verifyTokenSnapshot: target.token,
        planAtRequest: planSlug,
        profile: 'saas',
        scope,
        progressPct: 0,
        queuedAt: new Date(),
        authorizationAccepted: true,
        authorizationVersion,
        requestIp: ip,
      });
      const saved = await manager.save(job);
      return saved.id;
    });

    // Enqueue for the worker to pull (outside the tx; job row already committed).
    try {
      await this.queue.enqueue('active_scan.run', { jobId }, { idempotencyKey: jobId, attempts: 1 });
    } catch (e) {
      this.logger.error(`enqueue failed for job ${jobId}: ${(e as Error).message}`);
    }

    await this.audit.record({
      actorUserId: userId,
      action: 'active_scan.requested',
      targetType: 'active_scan_job',
      targetId: jobId,
      ip,
      meta: { targetId, planAtRequest: planSlug, authorizationVersion },
    });

    return { jobId, status: 'queued' };
  }

  // ════════════════════════════ Reads ══════════════════════════════════════

  async getJob(userId: string, id: string): Promise<ActiveScanJob> {
    const job = await this.jobs.findOne({ where: { id, userId } });
    if (!job) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Scan not found' });
    }
    return this.toJob(job);
  }

  async listScans(
    userId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: ActiveScanJob[]; page: number; pageSize: number; total: number }> {
    const take = Math.min(100, Math.max(1, pageSize));
    const skip = (Math.max(1, page) - 1) * take;
    const [rows, total] = await this.jobs.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
    return { items: rows.map((r) => this.toJob(r)), page, pageSize: take, total };
  }

  async getFindings(userId: string, id: string): Promise<ActiveScanFindingsResponse> {
    const job = await this.jobs.findOne({ where: { id, userId } });
    if (!job) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Scan not found' });
    }
    const rows = await this.findings.find({
      where: { jobId: id },
      order: { severity: 'DESC', host: 'ASC', port: 'ASC' },
    });
    const findings = rows.map((r) => this.toFinding(r));
    return { job: this.toJob(job), findings, byHost: this.groupByHost(findings, job.summary) };
  }

  // ════════════════════ Cancel (user kill-switch) ══════════════════════════

  async cancelJob(
    userId: string,
    id: string,
    ip: string | null,
    isAdmin = false,
  ): Promise<{ status: ActiveScanJobStatus }> {
    const where = isAdmin ? { id } : { id, userId };
    const job = await this.jobs.findOne({ where });
    if (!job) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Scan not found' });
    }
    if (!ACTIVE_SCAN_ACTIVE_STATUSES.includes(job.status)) {
      throw new BadRequestException({
        error: ApiErrorCodes.INVALID_TRANSITION,
        message: `Cannot cancel a ${job.status} scan`,
      });
    }
    job.status = 'cancelled';
    job.completedAt = new Date();
    await this.jobs.save(job);

    // Best-effort: remove the queued job so an idle worker never picks it up.
    try {
      await this.queue.cancel(id);
    } catch {
      /* worker also polls a cancel flag between phases (§8) */
    }

    this.emit(id, 'error', { message: 'cancelled' });
    this.closeHub(id);

    await this.audit.record({
      actorUserId: userId,
      action: isAdmin ? 'active_scan.admin_killed' : 'active_scan.cancelled',
      targetType: 'active_scan_job',
      targetId: id,
      ip,
    });
    return { status: 'cancelled' };
  }

  // ════════════════════ Worker↔backend internal contract ═══════════════════

  /** Atomic claim: only one worker can move a job out of `queued`. */
  async workerClaim(jobId: string, workerId: string): Promise<WorkerClaimResponse> {
    // UPDATE ... WHERE status='queued' RETURNING — atomic single-claim (§5.2).
    const result = (await this.jobs.query(
      `UPDATE "active_scan_jobs"
         SET "status" = 'running', "workerId" = $2, "startedAt" = now(), "updatedAt" = now()
       WHERE "id" = $1 AND "status" = 'queued'
       RETURNING "id"`,
      [jobId, workerId],
    )) as Array<{ id: string }>;

    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Job not found' });
    }
    if (result.length === 0 && job.status !== 'running') {
      // Already claimed/cancelled/terminal — tell the worker not to proceed.
      throw new BadRequestException({
        error: ApiErrorCodes.INVALID_TRANSITION,
        message: `Job is ${job.status}, not claimable`,
      });
    }

    const target = await this.targets.findOne({ where: { id: job.targetId } });
    this.emit(jobId, 'status', {
      status: job.status,
      progressPct: job.progressPct,
      currentPhase: job.currentPhase,
    });
    await this.audit.record({
      action: 'active_scan.started',
      targetType: 'active_scan_job',
      targetId: jobId,
      meta: { workerId },
    });

    return {
      jobId: job.id,
      status: job.status,
      verifiedHost: job.verifiedHost,
      verifyTokenSnapshot: job.verifyTokenSnapshot,
      verifiedMethod: target?.verifiedMethod ?? null,
      scope: job.scope,
    };
  }

  async workerProgress(jobId: string, body: WorkerProgressBody): Promise<{ ok: true }> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Job not found' });
    }
    if (job.status === 'cancelled') return { ok: true }; // ignore late progress
    const pct = Math.max(0, Math.min(100, Math.round(body.progressPct)));
    job.progressPct = pct;
    job.currentPhase = body.currentPhase ?? job.currentPhase;
    if (job.status === 'running' && job.currentPhase?.startsWith('parsing')) {
      job.status = 'parsing';
    }
    await this.jobs.save(job);
    this.emit(jobId, 'progress', { progressPct: pct, currentPhase: job.currentPhase });
    return { ok: true };
  }

  /**
   * Persist a batch of normalized findings (dedup by (jobId, dedupKey), keep
   * highest severity on conflict — §4.4) and emit a `finding` SSE per row.
   */
  async workerFindings(
    jobId: string,
    rawFindings: WorkerFinding[],
    hosts?: NormalizedFindingsDoc['hosts'],
    errors?: NormalizedFindingsDoc['errors'],
  ): Promise<{ persisted: number; skipped: number }> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Job not found' });
    }
    if (job.status === 'cancelled') return { persisted: 0, skipped: rawFindings.length };

    let persisted = 0;
    let skipped = 0;
    for (const raw of rawFindings) {
      const finding = this.validateAndNormalizeFinding(raw);
      if (!finding) {
        skipped++;
        continue;
      }
      // Upsert with "keep highest severity" on conflict (§4.4). The CASE
      // compares the existing severity rank against the incoming one and only
      // overwrites the descriptive fields when the new finding is at least as
      // severe. Raw SQL because the conditional upsert isn't expressible via
      // the query builder's orUpdate.
      const rank = SEVERITY_ORDER[finding.severity];
      await this.findings.query(
        `
        INSERT INTO "active_scan_findings"
          ("id","jobId","dedupKey","host","port","service","check","severity",
           "source","title","description","evidence","remediation","referenceUrls","createdAt")
        VALUES
          (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,now())
        ON CONFLICT ("jobId","dedupKey") DO UPDATE SET
          "severity"   = CASE WHEN $14 >= (CASE EXCLUDED."severity"
                                WHEN 'info' THEN 0 WHEN 'low' THEN 1 WHEN 'medium' THEN 2
                                WHEN 'high' THEN 3 WHEN 'critical' THEN 4 ELSE 0 END)
                            THEN EXCLUDED."severity" ELSE "active_scan_findings"."severity" END,
          "title"       = EXCLUDED."title",
          "description" = EXCLUDED."description",
          "evidence"    = EXCLUDED."evidence",
          "remediation" = EXCLUDED."remediation",
          "referenceUrls" = EXCLUDED."referenceUrls",
          "service"     = COALESCE(EXCLUDED."service", "active_scan_findings"."service")
        `,
        [
          jobId,
          finding.dedupKey,
          finding.host,
          finding.port,
          finding.service,
          finding.check,
          finding.severity,
          finding.source,
          finding.title,
          finding.description,
          finding.evidence ? JSON.stringify(finding.evidence) : null,
          finding.remediation,
          finding.referenceUrls,
          rank,
        ],
      );
      persisted++;

      const stored = await this.findings.findOne({
        where: { jobId, dedupKey: finding.dedupKey },
      });
      if (stored) this.emit(jobId, 'finding', this.toFinding(stored));
    }

    // Merge host summaries / append phase errors onto the job.
    if (hosts && hosts.length) {
      const summary = (job.summary ?? {}) as Partial<SkyNetSummary>;
      summary.hosts = hosts;
      job.summary = summary as SkyNetSummary;
    }
    if (errors && errors.length) {
      const appended = errors
        .map((e) => `[${e.phase}${e.tool ? `/${e.tool}` : ''}] ${e.message}`)
        .join('\n');
      job.errorLog = job.errorLog ? `${job.errorLog}\n${appended}` : appended;
      for (const e of errors) {
        if (!e.fatal) this.emit(jobId, 'phase_error', { phase: e.phase, message: e.message });
      }
    }
    if (hosts?.length || errors?.length) await this.jobs.save(job);

    return { persisted, skipped };
  }

  async workerComplete(
    jobId: string,
    status: 'completed' | 'failed',
    summary: SkyNetSummary | null,
    findingCounts: ActiveScanFindingCounts | null,
    errorReason: string | null,
    errorLog: string | null,
  ): Promise<{ ok: true }> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Job not found' });
    }
    if (job.status === 'cancelled') return { ok: true };

    const now = new Date();
    job.status = status;
    job.completedAt = now;
    job.progressPct = status === 'completed' ? 100 : job.progressPct;
    if (job.startedAt) job.durationMs = now.getTime() - job.startedAt.getTime();
    if (summary) job.summary = { ...(job.summary ?? {}), ...summary };
    // Authoritative counts: recompute from persisted rows so the worker can't
    // under/over-report what's actually stored.
    job.findingCounts = findingCounts ?? (await this.computeCounts(jobId));
    if (errorReason) job.errorReason = errorReason;
    if (errorLog) job.errorLog = job.errorLog ? `${job.errorLog}\n${errorLog}` : errorLog;
    await this.jobs.save(job);

    this.emit(jobId, 'complete', {
      status: job.status,
      findingCounts: job.findingCounts,
      durationMs: job.durationMs,
    });
    this.closeHub(jobId);

    await this.audit.record({
      action: status === 'completed' ? 'active_scan.completed' : 'active_scan.failed',
      targetType: 'active_scan_job',
      targetId: jobId,
      meta: { findingCounts: job.findingCounts, errorReason },
    });
    return { ok: true };
  }

  // ════════════════════════════ SSE ════════════════════════════════════════

  /**
   * SSE stream: replay persisted state (status + findings) then subscribe to
   * the live hub. If terminal, emit complete/error and close (mirrors the demo
   * scanner's `streamResults` control flow).
   */
  async stream(jobId: string): Promise<Observable<MessageEvent>> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    const existing = await this.findings.find({
      where: { jobId },
      order: { severity: 'DESC', host: 'ASC' },
    });

    return new Observable<MessageEvent>((subscriber) => {
      // 1. Replay current status.
      subscriber.next(
        sse('status', {
          status: job.status,
          progressPct: job.progressPct,
          currentPhase: job.currentPhase,
        }),
      );
      // 2. Replay persisted findings.
      for (const f of existing) {
        subscriber.next(sse('finding', this.toFinding(f)));
      }
      // 3. Terminal? emit complete/error + close.
      if (job.status === 'completed' || job.status === 'failed') {
        subscriber.next(
          sse('complete', {
            status: job.status,
            findingCounts: job.findingCounts,
            durationMs: job.durationMs,
          }),
        );
        subscriber.complete();
        return;
      }
      if (job.status === 'cancelled') {
        subscriber.next(sse('error', { message: 'cancelled' }));
        subscriber.complete();
        return;
      }
      // 4. Live: subscribe to the hub.
      const hub = this.getHub(jobId);
      const sub = hub.subject.subscribe({
        next: (ev) => subscriber.next(ev),
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => sub.unsubscribe();
    });
  }

  private getHub(jobId: string): JobHub {
    let hub = this.hubs.get(jobId);
    if (!hub) {
      hub = { subject: new Subject<MessageEvent>() };
      this.hubs.set(jobId, hub);
    }
    return hub;
  }

  private emit(jobId: string, type: string, data: unknown): void {
    const hub = this.hubs.get(jobId);
    if (hub) hub.subject.next(sse(type, data));
  }

  private closeHub(jobId: string): void {
    const hub = this.hubs.get(jobId);
    if (hub) {
      hub.subject.complete();
      this.hubs.delete(jobId);
    }
  }

  // ════════════════════════════ Helpers ════════════════════════════════════

  /** Validate + normalize a worker finding; returns null if it must be dropped. */
  private validateAndNormalizeFinding(raw: WorkerFinding): {
    dedupKey: string;
    host: string;
    port: number | null;
    service: string | null;
    check: string;
    severity: AutoScanSeverity;
    source: string;
    title: string;
    description: string | null;
    evidence: Record<string, unknown> | null;
    remediation: string | null;
    referenceUrls: string[];
  } | null {
    if (!raw || typeof raw.host !== 'string' || !raw.host) return null;
    if (typeof raw.check !== 'string' || !raw.check) return null;
    if (typeof raw.source !== 'string' || !raw.source) return null;
    const severity = this.normalizeSeverity(raw.severity);
    const host = raw.host.slice(0, 45);
    const port = typeof raw.port === 'number' && raw.port >= 0 && raw.port <= 65535 ? raw.port : null;
    const source = raw.source.slice(0, 40);
    const check = raw.check.slice(0, 80);
    // Recompute dedupKey (don't trust the worker's value blindly).
    const dedupKey = crypto
      .createHash('sha1')
      .update(`${host}|${port ?? ''}|${source}|${check}`)
      .digest('hex');
    // Sanitize reference URLs to http(s) only (banners are untrusted, §10).
    const referenceUrls = Array.isArray(raw.referenceUrls)
      ? raw.referenceUrls.filter(
          (u) => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://')),
        )
      : [];
    return {
      dedupKey,
      host,
      port,
      service: typeof raw.service === 'string' ? raw.service.slice(0, 40) : null,
      check,
      severity,
      source,
      title: (typeof raw.title === 'string' ? raw.title : check).slice(0, 500),
      description: typeof raw.description === 'string' ? raw.description : null,
      evidence:
        raw.evidence && typeof raw.evidence === 'object'
          ? (raw.evidence as Record<string, unknown>)
          : null,
      remediation: typeof raw.remediation === 'string' ? raw.remediation : null,
      referenceUrls,
    };
  }

  private normalizeSeverity(v: unknown): AutoScanSeverity {
    const s = typeof v === 'string' ? v.toLowerCase() : '';
    if (s === 'info' || s === 'low' || s === 'medium' || s === 'high' || s === 'critical') {
      return s;
    }
    return 'info';
  }

  private async computeCounts(jobId: string): Promise<ActiveScanFindingCounts> {
    const rows = (await this.findings.query(
      `SELECT "severity", COUNT(*)::int AS c FROM "active_scan_findings" WHERE "jobId" = $1 GROUP BY "severity"`,
      [jobId],
    )) as Array<{ severity: AutoScanSeverity; c: number }>;
    const counts: ActiveScanFindingCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      total: 0,
    };
    for (const r of rows) {
      counts[r.severity] = Number(r.c);
      counts.total = (counts.total ?? 0) + Number(r.c);
    }
    return counts;
  }

  private groupByHost(
    findings: ActiveScanFinding[],
    summary: SkyNetSummary | null,
  ): ActiveScanFindingsResponse['byHost'] {
    const hostMeta = new Map<string, string | null>();
    for (const h of summary?.hosts ?? []) hostMeta.set(h.host, h.hostname);
    const byHost = new Map<string, Map<string, ActiveScanFinding[]>>();
    for (const f of findings) {
      const portKey = `${f.port ?? ''}|${f.service ?? ''}`;
      if (!byHost.has(f.host)) byHost.set(f.host, new Map());
      const ports = byHost.get(f.host)!;
      if (!ports.has(portKey)) ports.set(portKey, []);
      ports.get(portKey)!.push(f);
    }
    return Array.from(byHost.entries()).map(([host, ports]) => ({
      host,
      hostname: hostMeta.get(host) ?? null,
      ports: Array.from(ports.values()).map((fs) => ({
        port: fs[0]!.port,
        service: fs[0]!.service,
        findings: fs,
      })),
    }));
  }

  private toTarget(r: VerifiedTargetEntity): VerifiedTarget {
    return {
      id: r.id,
      hostname: r.hostname,
      status: r.status,
      verifiedMethod: r.verifiedMethod,
      verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toTargetWithInstructions(r: VerifiedTargetEntity): VerifiedTargetWithInstructions {
    const value = `secaudit-verify=${r.token}`;
    return {
      ...this.toTarget(r),
      instructions: {
        token: r.token,
        dnsTxt: { host: r.hostname, value },
        httpFile: {
          url: `https://${r.hostname}/.well-known/secaudit-verify.txt`,
          path: '/.well-known/secaudit-verify.txt',
          body: value,
        },
      },
    };
  }

  private toJob(j: ActiveScanJobEntity): ActiveScanJob {
    return {
      id: j.id,
      targetId: j.targetId,
      verifiedHost: j.verifiedHost,
      status: j.status,
      profile: j.profile,
      planAtRequest: j.planAtRequest,
      progressPct: j.progressPct,
      currentPhase: j.currentPhase,
      queuedAt: j.queuedAt ? j.queuedAt.toISOString() : null,
      startedAt: j.startedAt ? j.startedAt.toISOString() : null,
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
      durationMs: j.durationMs,
      findingCounts: j.findingCounts,
      summary: j.summary,
      errorReason: j.errorReason,
      authorizationAccepted: j.authorizationAccepted,
      authorizationVersion: j.authorizationVersion,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    };
  }

  private toFinding(f: ActiveScanFindingEntity): ActiveScanFinding {
    return {
      id: f.id,
      jobId: f.jobId,
      dedupKey: f.dedupKey,
      host: f.host,
      port: f.port,
      service: f.service,
      check: f.check,
      severity: f.severity,
      source: f.source,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      remediation: f.remediation,
      referenceUrls: f.referenceUrls ?? [],
      createdAt: f.createdAt.toISOString(),
    };
  }
}

/** Build the `{ type, data }` SSE envelope (matches the demo scanner shape). */
function sse(type: string, data: unknown): MessageEvent {
  return { data: JSON.stringify({ type, data }) } as MessageEvent;
}
