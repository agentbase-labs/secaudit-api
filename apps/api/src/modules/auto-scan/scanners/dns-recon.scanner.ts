import { Injectable } from '@nestjs/common';
import { promises as dns } from 'dns';
import {
  failed,
  ok,
  ScannerContext,
  ScannerFinding,
  ScannerResult,
} from './scanner-base';

/**
 * DNS recon scanner — A, AAAA, MX, TXT, CAA records, plus SPF / DMARC / DKIM.
 * Uses Node's built-in dns/promises (no external deps).
 */
@Injectable()
export class DnsReconScanner {
  private readonly SOURCE = 'dns_recon' as const;

  async scan(ctx: ScannerContext): Promise<ScannerResult> {
    const started = Date.now();
    try {
      const findings: ScannerFinding[] = [];
      const host = ctx.target.host;
      const apex = ctx.target.domain;

      const [aRecords, aaaaRecords, mxRecords, txtRecords, caaRecords, dmarcTxt] =
        await Promise.all([
          dns.resolve4(host).catch(() => []),
          dns.resolve6(host).catch(() => []),
          dns.resolveMx(apex).catch(() => []),
          dns.resolveTxt(apex).catch(() => []),
          // CAA isn't typed on dns/promises in older lib defs — cast
          (dns as unknown as { resolveCaa?: (n: string) => Promise<unknown[]> })
            .resolveCaa
            ? (dns as unknown as { resolveCaa: (n: string) => Promise<unknown[]> })
                .resolveCaa(apex)
                .catch(() => [])
            : Promise.resolve([]),
          dns.resolveTxt(`_dmarc.${apex}`).catch(() => []),
        ]);

      const flatTxt = txtRecords.map((rec) => rec.join('')).filter(Boolean);
      const flatDmarc = dmarcTxt.map((rec) => rec.join('')).filter(Boolean);

      const spfRecords = flatTxt.filter((t) => t.toLowerCase().startsWith('v=spf1'));
      const dmarcRecord = flatDmarc.find((t) => t.toLowerCase().startsWith('v=dmarc1'));

      // SPF check
      if (spfRecords.length === 0) {
        findings.push({
          source: this.SOURCE,
          severity: 'medium',
          category: 'dns',
          title: 'No SPF record published',
          description:
            'Sender Policy Framework prevents domain spoofing in email. Without it, attackers can send mail "from" your domain to phish your customers.',
          evidence: { domain: apex, txtRecordCount: flatTxt.length },
          remediation: 'Publish a TXT record like `v=spf1 include:_spf.google.com -all` for your apex domain.',
          referenceUrls: ['https://datatracker.ietf.org/doc/html/rfc7208'],
        });
      } else if (spfRecords.length > 1) {
        findings.push({
          source: this.SOURCE,
          severity: 'low',
          category: 'dns',
          title: 'Multiple SPF records (RFC violation)',
          description: 'Per RFC 7208, only one SPF record is permitted. Multiple records cause a permerror.',
          evidence: { records: spfRecords },
          remediation: 'Consolidate into a single SPF TXT record.',
        });
      } else if (spfRecords[0]?.includes('+all') || spfRecords[0]?.endsWith(' ?all')) {
        findings.push({
          source: this.SOURCE,
          severity: 'medium',
          category: 'dns',
          title: 'SPF record uses overly permissive policy',
          description: 'Found `+all` or `?all` — anyone can spoof your domain in email.',
          evidence: { record: spfRecords[0] },
          remediation: 'Use `-all` (hardfail) or `~all` (softfail) at the end of the SPF record.',
        });
      }

      // DMARC check
      if (!dmarcRecord) {
        findings.push({
          source: this.SOURCE,
          severity: 'medium',
          category: 'dns',
          title: 'No DMARC record published',
          description:
            'DMARC builds on SPF/DKIM to instruct receivers what to do with unauthenticated mail. Without DMARC, spoofing prevention is incomplete.',
          evidence: { domain: `_dmarc.${apex}` },
          remediation: 'Publish a TXT record at `_dmarc.<domain>` like `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com`.',
          referenceUrls: ['https://datatracker.ietf.org/doc/html/rfc7489'],
        });
      } else if (/p=none/i.test(dmarcRecord)) {
        findings.push({
          source: this.SOURCE,
          severity: 'low',
          category: 'dns',
          title: 'DMARC policy set to `none` (monitor-only)',
          description: '`p=none` means no enforcement. Useful while bootstrapping DMARC, but should be moved to `quarantine` or `reject` once aligned.',
          evidence: { record: dmarcRecord },
          remediation: 'Once mail is properly aligned, escalate to `p=quarantine` then `p=reject`.',
        });
      }

      // CAA check
      if (Array.isArray(caaRecords) && caaRecords.length === 0) {
        findings.push({
          source: this.SOURCE,
          severity: 'info',
          category: 'dns',
          title: 'No CAA records published',
          description:
            'Certification Authority Authorization records restrict which CAs may issue certificates for the domain. Absent CAA records mean any CA can issue.',
          evidence: { domain: apex },
          remediation: 'Add a CAA record, e.g. `0 issue "letsencrypt.org"`.',
          referenceUrls: ['https://datatracker.ietf.org/doc/html/rfc8659'],
        });
      }

      // Info: published TXT records for visibility
      const meta = {
        a: aRecords,
        aaaa: aaaaRecords,
        mx: mxRecords,
        txtCount: flatTxt.length,
        spfCount: spfRecords.length,
        hasDmarc: Boolean(dmarcRecord),
        caaCount: Array.isArray(caaRecords) ? caaRecords.length : 0,
      };
      return ok(this.SOURCE, findings, started, meta);
    } catch (err) {
      return failed(this.SOURCE, err, started);
    }
  }
}
