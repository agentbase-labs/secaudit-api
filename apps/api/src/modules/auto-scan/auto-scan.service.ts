import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  AdminAutoScanResponse,
  ApiErrorCodes,
  AutoScanCategory,
  AutoScanFinding,
  AutoScanFindingCounts,
  AutoScanRun,
  AutoScanRunStatus,
  AutoScanScores,
  AutoScanSource,
  ClientAutoScanSummary,
  ScannerOutcome,
} from '@cs-platform/shared';

import { AutoScanFindingEntity } from './entities/auto-scan-finding.entity';
import { AutoScanRunEntity } from './entities/auto-scan-run.entity';
import { HttpFingerprintScanner } from './scanners/http-fingerprint.scanner';
import { DnsReconScanner } from './scanners/dns-recon.scanner';
import { TlsCertScanner } from './scanners/tls-cert.scanner';
import { CrtShScanner } from './scanners/crt-sh.scanner';
import { MozillaObservatoryScanner } from './scanners/mozilla-observatory.scanner';
import { SslLabsScanner } from './scanners/ssl-labs.scanner';
import { NucleiScanner } from './scanners/nuclei.scanner';
import { NiktoScanner } from './scanners/nikto.scanner';
import { ScannerContext, ScannerResult } from './scanners/scanner-base';
import { AuditService } from '../audit/audit.service';
import { TestingRequest } from '../requests/entities/testing-request.entity';

const TIER1_TIMEOUT_MS = 60_000;
const TIER2_TIMEOUT_MS = 5 * 60_000;

// Domain blocklist — never scan these.
const BLOCKED_TLDS = ['.gov', '.mil', '.gov.uk', '.gov.au', '.gov.ca'];

@Injectable()
export class AutoScanService {
  private readonly logger = new Logger(AutoScanService.name);

  constructor(
    @InjectRepository(AutoScanRunEntity)
    private readonly runRepo: Repository<AutoScanRunEntity>,
    @InjectRepository(AutoScanFindingEntity)
    private readonly findingRepo: Repository<AutoScanFindingEntity>,
    @InjectRepository(TestingRequest)
    private readonly requestRepo: Repository<TestingRequest>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly httpFingerprint: HttpFingerprintScanner,
    private readonly dnsRecon: DnsReconScanner,
    private readonly tlsCert: TlsCertScanner,
    private readonly crtSh: CrtShScanner,
    private readonly mozilla: MozillaObservatoryScanner,
    private readonly sslLabs: SslLabsScanner,
    private readonly nuclei: NucleiScanner,
    private readonly nikto: NiktoScanner,
  ) {}

  // ---------- Public entrypoint ----------

  /**
   * Fire-and-forget: starts a scan in the background. Returns the run id
   * immediately. The caller should NOT await this for the actual scan
   * results — use getLatestForRequest later.
   */
  async runScan(requestId: string, url: string): Promise<{ runId: string }> {
    if (this.isBlockedDomain(url)) {
      this.logger.warn(`auto-scan blocked for ${url} (blocklisted TLD)`);
      throw new Error('Target domain is blocklisted (gov/mil)');
    }

    const run = await this.runRepo.save(
      this.runRepo.create({
        requestId,
        status: 'pending',
      }),
    );
    // Run async — never block the caller.
    setImmediate(() => {
      this.executeScan(run.id, requestId, url).catch((err) => {
        this.logger.error(`auto-scan ${run.id} crashed: ${err instanceof Error ? err.message : err}`);
      });
    });
    return { runId: run.id };
  }

  // ---------- Admin views ----------

  async getForAdmin(requestId: string): Promise<AdminAutoScanResponse> {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    const history = await this.runRepo.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const latest = history[0] ?? null;
    const findings = latest
      ? await this.findingRepo.find({
          where: { scanId: latest.id },
          order: { severity: 'ASC', createdAt: 'ASC' },
        })
      : [];

    return {
      run: latest ? this.toApiRun(latest) : null,
      findings: findings.map((f) => this.toApiFinding(f)),
      history: history.map((h) => this.toApiRun(h)),
    };
  }

  async getSummaryForClient(requestId: string, userId: string): Promise<ClientAutoScanSummary> {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req || req.userId !== userId) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    const latest = await this.runRepo.findOne({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
    if (!latest) {
      return {
        status: 'not_started',
        completedAt: null,
        scores: { mozillaGrade: null, sslLabsGrade: null },
        findingCounts: null,
        totalFindings: 0,
      };
    }
    const counts = latest.findingCounts ?? null;
    const total = counts
      ? counts.critical + counts.high + counts.medium + counts.low + counts.info
      : 0;
    return {
      status: latest.status,
      completedAt: latest.completedAt?.toISOString() ?? null,
      scores: {
        mozillaGrade: latest.scores?.mozilla_observatory?.grade ?? null,
        sslLabsGrade: latest.scores?.ssl_labs?.grade ?? null,
      },
      findingCounts: counts,
      totalFindings: total,
    };
  }

  async promoteFinding(adminId: string, findingId: string, ip: string | null): Promise<AutoScanFinding> {
    const f = await this.findingRepo.findOne({ where: { id: findingId } });
    if (!f) throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    f.promotedToReport = true;
    f.dismissed = false;
    f.dismissedReason = null;
    await this.findingRepo.save(f);
    await this.audit.record({
      actorUserId: adminId,
      action: 'auto_scan.finding.promote',
      targetType: 'AutoScanFinding',
      targetId: findingId,
      ip,
      meta: { requestId: f.requestId, source: f.source, severity: f.severity },
    });
    return this.toApiFinding(f);
  }

  async dismissFinding(
    adminId: string,
    findingId: string,
    reason: string,
    ip: string | null,
  ): Promise<AutoScanFinding> {
    const f = await this.findingRepo.findOne({ where: { id: findingId } });
    if (!f) throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    f.dismissed = true;
    f.dismissedReason = reason.slice(0, 2000);
    f.promotedToReport = false;
    await this.findingRepo.save(f);
    await this.audit.record({
      actorUserId: adminId,
      action: 'auto_scan.finding.dismiss',
      targetType: 'AutoScanFinding',
      targetId: findingId,
      ip,
      meta: { requestId: f.requestId, source: f.source, severity: f.severity, reason: f.dismissedReason },
    });
    return this.toApiFinding(f);
  }

  // ---------- Internal: orchestrate ----------

  private async executeScan(runId: string, requestId: string, url: string): Promise<void> {
    const startedAt = new Date();
    await this.runRepo.update(
      { id: runId },
      { status: 'running' as AutoScanRunStatus, startedAt },
    );
    await this.audit.record({
      actorUserId: null,
      action: 'auto_scan.start',
      targetType: 'TestingRequest',
      targetId: requestId,
      meta: { runId, url },
    });

    const target = parseTarget(url);
    const ctx1: ScannerContext = {
      target,
      timeoutMs: TIER1_TIMEOUT_MS,
      log: (msg) => this.logger.debug(msg),
    };
    const ctx2: ScannerContext = {
      target,
      timeoutMs: TIER2_TIMEOUT_MS,
      log: (msg) => this.logger.debug(msg),
    };

    // ---- Tier 1 (parallel) ----
    const tier1Results = await Promise.allSettled([
      this.httpFingerprint.scan(ctx1),
      this.dnsRecon.scan(ctx1),
      this.tlsCert.scan(ctx1),
      this.crtSh.scan(ctx1),
      this.mozilla.scan(ctx1),
      this.sslLabs.scan(ctx1),
    ]);
    const tier1Outcomes = tier1Results.map((r) =>
      r.status === 'fulfilled' ? r.value : null,
    );
    const tier1AnyOk = tier1Outcomes.some((r) => r?.outcome === 'ok');

    // ---- Tier 2 (parallel, only if any tier1 succeeded) ----
    let tier2Outcomes: (ScannerResult | null)[] = [];
    if (tier1AnyOk) {
      const tier2Results = await Promise.allSettled([
        this.nuclei.scan(ctx2),
        this.nikto.scan(ctx2),
      ]);
      tier2Outcomes = tier2Results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    }

    const allResults = [...tier1Outcomes, ...tier2Outcomes].filter(
      (r): r is ScannerResult => r !== null,
    );

    // Persist findings + tally
    const counts: AutoScanFindingCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const findingsToInsert: Partial<AutoScanFindingEntity>[] = [];
    for (const r of allResults) {
      for (const f of r.findings) {
        counts[f.severity] = (counts[f.severity] ?? 0) + 1;
        findingsToInsert.push({
          requestId,
          scanId: runId,
          source: f.source,
          severity: f.severity,
          category: f.category,
          title: f.title.slice(0, 480),
          description: f.description ?? null,
          evidence: f.evidence ?? null,
          remediation: f.remediation ?? null,
          referenceUrls: (f.referenceUrls ?? []).slice(0, 16),
        });
      }
    }
    if (findingsToInsert.length > 0) {
      // Batch insert in chunks of 100 to stay under parameter limits.
      for (let i = 0; i < findingsToInsert.length; i += 100) {
        const chunk = findingsToInsert.slice(i, i + 100);
        await this.findingRepo.save(this.findingRepo.create(chunk));
      }
    }

    // Build per-tool status maps
    const tier1Status = buildStatusMap(
      ['http_fingerprint', 'dns_recon', 'tls_cert', 'crt_sh', 'mozilla_observatory', 'ssl_labs'],
      tier1Outcomes,
    );
    const tier2Status = tier1AnyOk
      ? buildStatusMap(['nuclei', 'nikto'], tier2Outcomes)
      : null;

    // Scores
    const scores: AutoScanScores = {
      mozilla_observatory: extractMozilla(allResults) ?? null,
      ssl_labs: extractSslLabs(allResults) ?? null,
    };

    // Determine final run status
    const okCount = allResults.filter((r) => r.outcome === 'ok').length;
    const totalRun = allResults.length;
    let finalStatus: AutoScanRunStatus;
    if (okCount === 0) finalStatus = 'failed';
    else if (okCount === totalRun) finalStatus = 'complete';
    else finalStatus = 'partial';

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await this.runRepo.update(
      { id: runId },
      {
        status: finalStatus,
        completedAt,
        durationMs,
        tier1Status,
        tier2Status,
        findingCounts: counts,
        scores,
      },
    );

    await this.audit.record({
      actorUserId: null,
      action: 'auto_scan.complete',
      targetType: 'TestingRequest',
      targetId: requestId,
      meta: { runId, status: finalStatus, counts, durationMs },
    });

    this.logger.log(
      `auto-scan ${runId} ${finalStatus} in ${durationMs}ms — ${findingsToInsert.length} findings ` +
        `(C${counts.critical} H${counts.high} M${counts.medium} L${counts.low} I${counts.info})`,
    );
  }

  // ---------- Helpers ----------

  private isBlockedDomain(url: string): boolean {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      return BLOCKED_TLDS.some((tld) => host === tld.slice(1) || host.endsWith(tld));
    } catch {
      return true; // malformed URL = block
    }
  }

  private toApiRun(r: AutoScanRunEntity): AutoScanRun {
    return {
      id: r.id,
      requestId: r.requestId,
      status: r.status,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      durationMs: r.durationMs,
      tier1Status: r.tier1Status as AutoScanRun['tier1Status'],
      tier2Status: r.tier2Status as AutoScanRun['tier2Status'],
      findingCounts: r.findingCounts,
      scores: r.scores,
      errorLog: r.errorLog,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toApiFinding(f: AutoScanFindingEntity): AutoScanFinding {
    return {
      id: f.id,
      requestId: f.requestId,
      scanId: f.scanId,
      source: f.source,
      severity: f.severity,
      category: f.category as AutoScanCategory,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      remediation: f.remediation,
      referenceUrls: f.referenceUrls ?? [],
      promotedToReport: f.promotedToReport,
      dismissed: f.dismissed,
      dismissedReason: f.dismissedReason,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  }
}

function parseTarget(url: string): { url: string; host: string; domain: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid target URL: ${url}`);
  }
  const host = u.hostname;
  // Best-effort apex extraction. For ccTLDs (.co.uk etc.) this is imperfect
  // but good enough for crt.sh / DMARC lookups.
  const parts = host.split('.');
  let domain = host;
  if (parts.length >= 3) {
    const last = parts[parts.length - 1] ?? '';
    const second = parts[parts.length - 2] ?? '';
    const isCountryCo = last.length === 2 && ['co', 'com', 'gov', 'org', 'ac', 'net'].includes(second);
    domain = isCountryCo ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
  } else {
    domain = parts.slice(-2).join('.') || host;
  }
  return { url, host, domain };
}

function buildStatusMap(
  expected: AutoScanSource[] | string[],
  results: (ScannerResult | null)[],
): Record<string, ScannerOutcome> {
  const map: Record<string, ScannerOutcome> = {};
  for (let i = 0; i < expected.length; i++) {
    const r = results[i];
    map[expected[i]!] = r?.outcome ?? 'failed';
  }
  return map;
}

function extractMozilla(results: ScannerResult[]): { grade: string; score: number } | null {
  const r = results.find((x) => x.source === 'mozilla_observatory' && x.outcome === 'ok');
  if (!r || !r.meta) return null;
  const grade = (r.meta as { grade?: string }).grade;
  const score = (r.meta as { score?: number }).score;
  if (!grade || score === undefined) return null;
  return { grade, score };
}

function extractSslLabs(results: ScannerResult[]): { grade: string } | null {
  const r = results.find((x) => x.source === 'ssl_labs' && x.outcome === 'ok');
  if (!r || !r.meta) return null;
  const grade = (r.meta as { grade?: string | null }).grade;
  return grade ? { grade } : null;
}

// Force imports to keep tree-shaker happy in some build configs.
void In;
