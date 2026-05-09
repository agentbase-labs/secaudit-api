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
 * SSL Labs API — free public API. Polls until READY (~60-90s typical).
 * Returns: A+ to T grade, protocols, ciphers, known vulns.
 */
@Injectable()
export class SslLabsScanner {
  private readonly SOURCE = 'ssl_labs' as const;
  private readonly BASE = 'https://api.ssllabs.com/api/v3';

  async scan(ctx: ScannerContext): Promise<ScannerResult> {
    const started = Date.now();
    try {
      if (!ctx.target.url.startsWith('https://')) {
        return ok(this.SOURCE, [], started, { skipped: 'http target' });
      }
      const host = ctx.target.host;

      // SSL Labs supports `fromCache=on&maxAge=24` so we don't requeue every time.
      let url = `${this.BASE}/analyze?host=${encodeURIComponent(host)}&fromCache=on&maxAge=24&all=on`;
      let body = await this.poll(url);

      if (!body) {
        return ok(this.SOURCE, [], started, { error: 'ssl labs unreachable' });
      }

      // If status is DNS or IN_PROGRESS, poll a few more times
      const deadline = Date.now() + 110_000; // up to ~2 min total
      while (
        body.status &&
        body.status !== 'READY' &&
        body.status !== 'ERROR' &&
        Date.now() < deadline
      ) {
        await sleep(8000);
        url = `${this.BASE}/analyze?host=${encodeURIComponent(host)}&all=on`;
        const next = await this.poll(url);
        if (!next) break;
        body = next;
      }

      if (body.status !== 'READY') {
        return ok(this.SOURCE, [], started, {
          error: `ssl labs status=${body.status ?? 'unknown'}`,
        });
      }

      const findings: ScannerFinding[] = [];
      const endpoints = body.endpoints ?? [];
      const grades = endpoints.map((e) => e.grade).filter(Boolean) as string[];
      const worst = grades.sort(gradeWorseFirst)[0] ?? null;

      for (const ep of endpoints) {
        const grade = ep.grade;
        if (!grade) continue;
        if (/^T$/i.test(grade) || /^F$/i.test(grade)) {
          findings.push({
            source: this.SOURCE,
            severity: 'high',
            category: 'tls',
            title: `SSL Labs grade: ${grade} on ${ep.ipAddress}`,
            description:
              grade === 'T'
                ? 'Cert is not trusted (chain issue or untrusted CA).'
                : 'TLS configuration is severely broken (insecure protocols, weak ciphers, or known vulnerabilities).',
            evidence: { ipAddress: ep.ipAddress, grade, hasWarnings: ep.hasWarnings },
            referenceUrls: [`https://www.ssllabs.com/ssltest/analyze.html?d=${host}`],
          });
        } else if (/^C/i.test(grade)) {
          findings.push({
            source: this.SOURCE,
            severity: 'medium',
            category: 'tls',
            title: `SSL Labs grade: ${grade} on ${ep.ipAddress}`,
            description: 'Several TLS configuration issues — weak ciphers or protocols enabled.',
            evidence: { ipAddress: ep.ipAddress, grade },
            referenceUrls: [`https://www.ssllabs.com/ssltest/analyze.html?d=${host}`],
          });
        } else if (/^B/i.test(grade)) {
          findings.push({
            source: this.SOURCE,
            severity: 'low',
            category: 'tls',
            title: `SSL Labs grade: ${grade} on ${ep.ipAddress}`,
            evidence: { ipAddress: ep.ipAddress, grade },
            referenceUrls: [`https://www.ssllabs.com/ssltest/analyze.html?d=${host}`],
          });
        }

        // Specific vulns
        const det = ep.details ?? {};
        if (det.heartbleed) addVuln(findings, host, 'Heartbleed (CVE-2014-0160)', 'critical');
        if (det.poodle) addVuln(findings, host, 'POODLE (CVE-2014-3566)', 'high');
        if (det.poodleTls) addVuln(findings, host, 'POODLE TLS', 'high');
        if (det.freak) addVuln(findings, host, 'FREAK', 'high');
        if (det.logjam) addVuln(findings, host, 'Logjam', 'high');
        if (det.drownVulnerable) addVuln(findings, host, 'DROWN', 'high');
        if (det.ticketbleed === 2) addVuln(findings, host, 'Ticketbleed', 'high');
        if (det.openSslCcs === 2 || det.openSslCcs === 3) addVuln(findings, host, 'OpenSSL CCS Injection (CVE-2014-0224)', 'high');
        if (det.openSSLLuckyMinus20 === 2) addVuln(findings, host, 'OpenSSL LuckyMinus20 (CVE-2016-2107)', 'high');
        if (det.bleichenbacher && det.bleichenbacher.result && det.bleichenbacher.result > 1) {
          addVuln(findings, host, 'Bleichenbacher (ROBOT)', 'high');
        }
        if (det.zombiePoodle === 2) addVuln(findings, host, 'Zombie POODLE', 'high');
        if (det.goldenDoodle === 4 || det.goldenDoodle === 5) addVuln(findings, host, 'GOLDENDOODLE', 'high');
      }

      return ok(this.SOURCE, findings, started, {
        grade: worst,
        endpointCount: endpoints.length,
      });
    } catch (err) {
      return failed(this.SOURCE, err, started);
    }
  }

  private async poll(url: string): Promise<SslLabsAnalyze | null> {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 25000 });
      if (!res.ok) return null;
      return (await res.json()) as SslLabsAnalyze;
    } catch {
      return null;
    }
  }
}

interface SslLabsAnalyze {
  status?: string;
  statusMessage?: string;
  endpoints?: SslLabsEndpoint[];
}

interface SslLabsEndpoint {
  ipAddress?: string;
  grade?: string;
  hasWarnings?: boolean;
  details?: {
    heartbleed?: boolean;
    poodle?: boolean;
    poodleTls?: number;
    freak?: boolean;
    logjam?: boolean;
    drownVulnerable?: boolean;
    ticketbleed?: number;
    openSslCcs?: number;
    openSSLLuckyMinus20?: number;
    bleichenbacher?: { result?: number };
    zombiePoodle?: number;
    goldenDoodle?: number;
  };
}

function addVuln(arr: ScannerFinding[], host: string, name: string, sev: 'critical' | 'high' | 'medium'): void {
  arr.push({
    source: 'ssl_labs',
    severity: sev,
    category: 'tls',
    title: `Vulnerable to ${name}`,
    description: `SSL Labs detected this host is affected by ${name}.`,
    evidence: { host, vuln: name },
    remediation: 'Upgrade TLS library / disable weak protocols/ciphers. See SSL Labs full report.',
    referenceUrls: [`https://www.ssllabs.com/ssltest/analyze.html?d=${host}`],
  });
}

const GRADE_ORDER: Record<string, number> = {
  'A+': 0, A: 1, 'A-': 2, B: 3, C: 4, D: 5, E: 6, F: 7, T: 8, M: 9,
};
function gradeWorseFirst(a: string, b: string): number {
  return (GRADE_ORDER[b] ?? 0) - (GRADE_ORDER[a] ?? 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
