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
 * Subdomain enumeration via crt.sh — public Certificate Transparency logs.
 * Free, no API key. Returns all certs ever issued for the apex domain;
 * we extract the unique subdomain set.
 */
@Injectable()
export class CrtShScanner {
  private readonly SOURCE = 'crt_sh' as const;

  async scan(ctx: ScannerContext): Promise<ScannerResult> {
    const started = Date.now();
    try {
      const apex = ctx.target.domain;
      const url = `https://crt.sh/?q=${encodeURIComponent('%.' + apex)}&output=json`;
      const res = await fetchWithTimeout(url, {
        timeoutMs: 30000,
        headers: { Accept: 'application/json', 'User-Agent': 'secaudit-recon/1.0' },
      });
      if (!res.ok) {
        return ok(this.SOURCE, [], started, { error: `crt.sh status ${res.status}` });
      }
      const text = await res.text();
      let entries: Array<{ name_value?: string }> = [];
      try {
        entries = JSON.parse(text) as Array<{ name_value?: string }>;
      } catch {
        return ok(this.SOURCE, [], started, { error: 'crt.sh returned non-JSON' });
      }

      const subdomains = new Set<string>();
      for (const e of entries) {
        const nv = e.name_value ?? '';
        for (const name of nv.split(/\s+/)) {
          const norm = name.toLowerCase().trim().replace(/^\*\./, '');
          if (!norm) continue;
          if (norm === apex || norm.endsWith('.' + apex)) {
            subdomains.add(norm);
          }
        }
      }
      const list = [...subdomains].sort();
      const findings: ScannerFinding[] = [];

      // Heuristic: lots of staging/dev/admin subdomains is worth flagging.
      const interesting = list.filter((s) =>
        /\b(dev|staging|stage|test|qa|admin|jenkins|gitlab|jira|kibana|grafana|backup|old|legacy|internal)\b/i.test(s),
      );
      if (interesting.length > 0) {
        findings.push({
          source: this.SOURCE,
          severity: 'low',
          category: 'subdomain',
          title: `${interesting.length} potentially sensitive subdomain(s) discovered via CT logs`,
          description:
            'Certificate Transparency logs surfaced subdomains with names suggesting non-prod or admin services. ' +
            'These should be reviewed for exposure (auth, IP allow-lists, decommissioning).',
          evidence: { samples: interesting.slice(0, 25), totalSensitive: interesting.length },
          remediation:
            'Review each subdomain. Decommission unused, restrict admin/dev to VPN or IP allow-list, ensure auth is enforced.',
          referenceUrls: ['https://crt.sh/'],
        });
      }

      return ok(this.SOURCE, findings, started, {
        subdomainCount: list.length,
        subdomains: list.slice(0, 100),
      });
    } catch (err) {
      return failed(this.SOURCE, err, started);
    }
  }
}
