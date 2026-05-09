import { Injectable } from '@nestjs/common';
import {
  failed,
  fetchWithTimeout,
  ok,
  ScannerContext,
  ScannerFinding,
  ScannerResult,
} from './scanner-base';

/**
 * Mozilla HTTP Observatory — free public API. Submits the host and polls
 * until the scan is done, then returns grade + score + per-test results.
 */
@Injectable()
export class MozillaObservatoryScanner {
  private readonly SOURCE = 'mozilla_observatory' as const;
  private readonly BASE = 'https://http-observatory.security.mozilla.org/api/v1';

  async scan(ctx: ScannerContext): Promise<ScannerResult> {
    const started = Date.now();
    try {
      const host = ctx.target.host;

      // 1) Trigger scan (POST). Observatory accepts simple form-encoded body.
      const trigger = await fetchWithTimeout(
        `${this.BASE}/analyze?host=${encodeURIComponent(host)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'hidden=true&rescan=false',
          timeoutMs: 30000,
        },
      );
      if (!trigger.ok) {
        return ok(this.SOURCE, [], started, { error: `trigger status ${trigger.status}` });
      }
      const initial = (await trigger.json()) as ObservatoryScan;

      // 2) Poll until FINISHED or timeout
      let scan = initial;
      const pollDeadline = Date.now() + 50_000;
      while (scan.state !== 'FINISHED' && scan.state !== 'FAILED' && Date.now() < pollDeadline) {
        await sleep(3000);
        const r = await fetchWithTimeout(
          `${this.BASE}/analyze?host=${encodeURIComponent(host)}`,
          { timeoutMs: 15000 },
        );
        if (!r.ok) break;
        scan = (await r.json()) as ObservatoryScan;
      }

      if (scan.state !== 'FINISHED') {
        return ok(this.SOURCE, [], started, { error: `scan state ${scan.state}` });
      }

      const findings: ScannerFinding[] = [];
      const score = scan.score ?? null;
      const grade = scan.grade ?? null;

      // Grade-based finding: F/D = high, C = medium, B = low, A/A+ = none
      if (grade) {
        if (/^[FE]/i.test(grade)) {
          findings.push({
            source: this.SOURCE,
            severity: 'high',
            category: 'misconfig',
            title: `Mozilla Observatory grade: ${grade} (${score ?? 'n/a'}/130)`,
            description:
              'Mozilla\'s HTTP Observatory rates basic web security configuration. A failing grade indicates several missing controls (CSP, HSTS, cookies, etc.).',
            evidence: { grade, score },
            remediation: 'Review the per-test breakdown in the admin auto-recon view and address each failed test.',
            referenceUrls: [`https://observatory.mozilla.org/analyze/${host}`],
          });
        } else if (/^D/i.test(grade)) {
          findings.push({
            source: this.SOURCE,
            severity: 'medium',
            category: 'misconfig',
            title: `Mozilla Observatory grade: ${grade} (${score ?? 'n/a'}/130)`,
            description: 'Web security configuration is weak — multiple controls missing or misconfigured.',
            evidence: { grade, score },
            remediation: 'Address missing security headers (CSP, HSTS, etc.).',
            referenceUrls: [`https://observatory.mozilla.org/analyze/${host}`],
          });
        } else if (/^C/i.test(grade)) {
          findings.push({
            source: this.SOURCE,
            severity: 'low',
            category: 'misconfig',
            title: `Mozilla Observatory grade: ${grade} (${score ?? 'n/a'}/130)`,
            evidence: { grade, score },
            referenceUrls: [`https://observatory.mozilla.org/analyze/${host}`],
          });
        }
      }

      // 3) Pull per-test results
      const scanId = scan.scan_id;
      if (scanId) {
        try {
          const r = await fetchWithTimeout(
            `${this.BASE}/getScanResults?scan=${scanId}`,
            { timeoutMs: 15000 },
          );
          if (r.ok) {
            const tests = (await r.json()) as Record<string, ObservatoryTest>;
            for (const [name, t] of Object.entries(tests)) {
              if (!t || t.pass !== false) continue;
              const sev = t.score_modifier !== undefined && t.score_modifier <= -25
                ? 'medium'
                : t.score_modifier !== undefined && t.score_modifier <= -10
                  ? 'low'
                  : 'info';
              findings.push({
                source: this.SOURCE,
                severity: sev,
                category: 'misconfig',
                title: `Observatory: ${humanizeTestName(name)} — failed`,
                description: t.score_description ?? null,
                evidence: { test: name, score_modifier: t.score_modifier, output: t.output ?? null },
                referenceUrls: [`https://observatory.mozilla.org/analyze/${host}`],
              });
            }
          }
        } catch {
          // tolerate per-test fetch failures
        }
      }

      return ok(this.SOURCE, findings, started, {
        grade,
        score,
        scanId,
        host,
      });
    } catch (err) {
      return failed(this.SOURCE, err, started);
    }
  }
}

interface ObservatoryScan {
  state?: string;
  scan_id?: number;
  grade?: string;
  score?: number;
  tests_failed?: number;
  tests_passed?: number;
  tests_quantity?: number;
}

interface ObservatoryTest {
  pass?: boolean;
  score_modifier?: number;
  score_description?: string;
  result?: string;
  output?: unknown;
}

function humanizeTestName(name: string): string {
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
