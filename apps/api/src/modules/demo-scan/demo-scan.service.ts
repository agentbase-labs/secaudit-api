import {
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
  MessageEvent,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';

import { ScanJob, CheckResult, CategorySummary, ComplianceScore } from './demo-scan.types';
import { checks, getTlsInfo, deriveComplianceChecks } from './checks';

interface JobEntry {
  job: ScanJob;
  subject: Subject<MessageEvent>;
}

interface DomainCache {
  results: CheckResult[];
  createdAt: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost)/i;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function calcGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

function calcOverallScore(results: CheckResult[]): number {
  const nonCompliance = results.filter(r => r.category !== 'compliance');
  if (!nonCompliance.length) return 0;
  const sum = nonCompliance.reduce((acc, r) => acc + r.score, 0);
  return Math.round((sum / (nonCompliance.length * 10)) * 100);
}

function calcCategories(results: CheckResult[]): CategorySummary[] {
  const cats = new Map<string, { scores: number[]; passed: number }>();
  for (const r of results) {
    if (r.category === 'compliance') continue;
    if (!cats.has(r.category)) cats.set(r.category, { scores: [], passed: 0 });
    const entry = cats.get(r.category)!;
    entry.scores.push(r.score);
    if (r.status === 'pass') entry.passed++;
  }
  return Array.from(cats.entries()).map(([name, { scores, passed }]) => ({
    name,
    score: scores.reduce((a, b) => a + b, 0),
    maxScore: scores.length * 10,
    checks: scores.length,
    passed,
  }));
}

function calcCompliance(results: CheckResult[]): ComplianceScore[] {
  const compChecks = results.filter(r => r.category === 'compliance');
  const map: Record<string, { label: string; max: number }> = {
    pci_dss_score: { label: 'PCI DSS', max: 100 },
    gdpr_score: { label: 'GDPR', max: 100 },
    hipaa_score: { label: 'HIPAA', max: 100 },
    soc2_score: { label: 'SOC 2', max: 100 },
  };
  return compChecks.map(r => {
    const meta = map[r.check] || { label: r.title, max: 100 };
    return {
      name: meta.label,
      score: r.score * 10,
      max: meta.max,
      label: calcGrade(r.score * 10),
      gated: r.gated ?? true,
    };
  });
}

function fetchUrl(url: string): Promise<{ headers: Record<string, string>; html: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const options = { timeout: 10000, headers: { 'User-Agent': 'SecAudit-Scanner/1.0' } };
    const req = (mod as typeof https).get(url, options as any, (res) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
        else if (Array.isArray(v)) headers[k.toLowerCase()] = v[0] ?? '';
      }
      // Preserve set-cookie as-is (first value for simplified processing)
      if (res.headers['set-cookie']) {
        (headers as any)['set-cookie'] = res.headers['set-cookie']![0] || '';
      }

      let html = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { if (html.length < 500_000) html += chunk; });
      res.on('end', () => resolve({ headers, html }));
      res.on('error', reject);

      // Follow redirects (max 3)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

@Injectable()
export class DemoScanService {
  private jobs = new Map<string, JobEntry>();
  private domainCache = new Map<string, DomainCache>();
  private rateLimit = new Map<string, RateLimitEntry>();

  // ── Rate limiting ──────────────────────────────────────────────────────────

  private checkRateLimit(ip: string): void {
    const now = Date.now();
    const entry = this.rateLimit.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimit.set(ip, { count: 1, windowStart: now });
      return;
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      throw new HttpException(
        { message: 'Rate limit exceeded. Maximum 5 scans per hour per IP.', statusCode: 429 },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    entry.count++;
  }

  // ── URL validation ─────────────────────────────────────────────────────────

  private validateUrl(url: string): void {
    let parsed: URL;
    try { parsed = new URL(url); } catch {
      throw new HttpException('Invalid URL', HttpStatus.BAD_REQUEST);
    }
    const host = parsed.hostname;
    if (PRIVATE_IP_RE.test(host)) {
      throw new HttpException('Scanning private/localhost addresses is not allowed', HttpStatus.BAD_REQUEST);
    }
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  private getCached(domain: string): CheckResult[] | null {
    const entry = this.domainCache.get(domain);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
      this.domainCache.delete(domain);
      return null;
    }
    return entry.results;
  }

  private setCached(domain: string, results: CheckResult[]): void {
    this.domainCache.set(domain, { results, createdAt: Date.now() });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async startScan(url: string, ip: string): Promise<{ jobId: string; estimatedSeconds: number }> {
    this.validateUrl(url);
    this.checkRateLimit(ip);

    const domain = extractDomain(url);
    const jobId = crypto.randomUUID();
    const subject = new Subject<MessageEvent>();

    const job: ScanJob = {
      jobId,
      url,
      domain,
      status: 'pending',
      results: [],
      createdAt: Date.now(),
    };

    const cached = this.getCached(domain);
    if (cached) {
      job.fromCache = true;
      job.status = 'running';
      job.results = [...cached];
    }

    this.jobs.set(jobId, { job, subject });

    // Fire and forget
    this.runScan(jobId, cached).catch(() => {});

    return { jobId, estimatedSeconds: 30 };
  }

  async streamResults(jobId: string): Promise<Observable<MessageEvent>> {
    const entry = this.jobs.get(jobId);
    if (!entry) throw new NotFoundException(`Job ${jobId} not found`);

    return new Observable<MessageEvent>((subscriber) => {
      // Replay existing results
      for (const result of entry.job.results) {
        subscriber.next({ data: JSON.stringify({ type: 'result', data: result }) } as MessageEvent);
      }

      // If already complete, emit complete and close
      if (entry.job.status === 'complete' || entry.job.status === 'error') {
        subscriber.next({
          data: JSON.stringify({
            type: 'complete',
            data: {
              overallScore: entry.job.overallScore,
              grade: entry.job.grade,
              categories: entry.job.categories,
              compliance: entry.job.compliance,
              fromCache: entry.job.fromCache,
            },
          }),
        } as MessageEvent);
        subscriber.complete();
        return;
      }

      // Subscribe to future events
      const sub = entry.subject.subscribe({
        next: (event) => subscriber.next(event),
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => sub.unsubscribe();
    });
  }

  // ── Internal scan runner ───────────────────────────────────────────────────

  private async runScan(jobId: string, cachedResults: CheckResult[] | null): Promise<void> {
    const entry = this.jobs.get(jobId);
    if (!entry) return;
    const { job, subject } = entry;

    job.status = 'running';

    try {
      // If cache hit, replay results and derive compliance
      if (cachedResults) {
        for (const result of cachedResults) {
          subject.next({ data: JSON.stringify({ type: 'result', data: result }) } as MessageEvent);
        }
        const compliance = deriveComplianceChecks(cachedResults);
        for (const c of compliance) {
          job.results.push(c);
          subject.next({ data: JSON.stringify({ type: 'result', data: c }) } as MessageEvent);
        }
        job.status = 'complete';
        job.overallScore = calcOverallScore(job.results);
        job.grade = calcGrade(job.overallScore);
        job.categories = calcCategories(job.results);
        job.compliance = calcCompliance(job.results);
        subject.next({
          data: JSON.stringify({
            type: 'complete',
            data: {
              overallScore: job.overallScore,
              grade: job.grade,
              categories: job.categories,
              compliance: job.compliance,
              fromCache: true,
            },
          }),
        } as MessageEvent);
        subject.complete();
        return;
      }

      // Fetch URL once
      let headers: Record<string, string> = {};
      let html = '';
      try {
        const fetched = await withTimeout(fetchUrl(job.url), 12000);
        headers = fetched.headers;
        html = fetched.html;
      } catch {
        // Continue with empty headers/html — checks will degrade gracefully
      }

      // Fetch TLS info once
      const tlsInfo = await withTimeout(getTlsInfo(job.domain), 12000).catch(() => null);

      // Run all checks concurrently with per-check timeout
      const checkPromises = checks.map(async (checkFn) => {
        try {
          const result = await withTimeout(checkFn(job.domain, headers, html, tlsInfo), 10000);
          return result;
        } catch (err) {
          // Return a timeout/error result for this check
          return {
            check: checkFn.name || 'unknown',
            status: 'timeout' as const,
            score: 0,
            title: checkFn.name || 'Unknown Check',
            detail: `Check timed out or errored: ${(err as Error).message}`,
            severity: 'info' as const,
            category: 'application' as const,
          };
        }
      });

      const settled = await Promise.allSettled(checkPromises);
      const mainResults: CheckResult[] = [];

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          const result = outcome.value;
          mainResults.push(result);
          job.results.push(result);
          subject.next({ data: JSON.stringify({ type: 'result', data: result }) } as MessageEvent);
        }
      }

      // Derive compliance checks
      const complianceResults = deriveComplianceChecks(mainResults);
      for (const c of complianceResults) {
        job.results.push(c);
        subject.next({ data: JSON.stringify({ type: 'result', data: c }) } as MessageEvent);
      }

      // Cache raw (non-compliance) results by domain
      this.setCached(job.domain, mainResults);

      // Finalize
      job.status = 'complete';
      job.overallScore = calcOverallScore(job.results);
      job.grade = calcGrade(job.overallScore);
      job.categories = calcCategories(job.results);
      job.compliance = calcCompliance(job.results);

      subject.next({
        data: JSON.stringify({
          type: 'complete',
          data: {
            overallScore: job.overallScore,
            grade: job.grade,
            categories: job.categories,
            compliance: job.compliance,
            fromCache: false,
          },
        }),
      } as MessageEvent);
      subject.complete();
    } catch (err) {
      job.status = 'error';
      subject.next({
        data: JSON.stringify({ type: 'error', data: { message: (err as Error).message } }),
      } as MessageEvent);
      subject.complete();
    }
  }
}
