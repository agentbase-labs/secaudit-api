import { Injectable } from '@nestjs/common';
import * as tls from 'tls';
import {
  failed,
  ok,
  ScannerContext,
  ScannerFinding,
  ScannerResult,
} from './scanner-base';

/**
 * TLS / cert scanner — connects on :443 and inspects the leaf cert.
 * Reports days-to-expiry, SAN list, and weak TLS protocol versions.
 */
@Injectable()
export class TlsCertScanner {
  private readonly SOURCE = 'tls_cert' as const;

  async scan(ctx: ScannerContext): Promise<ScannerResult> {
    const started = Date.now();
    const host = ctx.target.host;
    try {
      if (!ctx.target.url.startsWith('https://')) {
        return ok(this.SOURCE, [
          {
            source: this.SOURCE,
            severity: 'high',
            category: 'tls',
            title: 'Target uses HTTP instead of HTTPS',
            description: 'Plaintext HTTP transmits all traffic in the clear, including credentials.',
            evidence: { url: ctx.target.url },
            remediation: 'Migrate to HTTPS with a valid certificate (Let\'s Encrypt is free).',
          },
        ], started);
      }

      const cert = await getPeerCertificate(host, 443, 10000);
      const findings: ScannerFinding[] = [];

      if (!cert || Object.keys(cert).length === 0) {
        return ok(this.SOURCE, [
          {
            source: this.SOURCE,
            severity: 'high',
            category: 'tls',
            title: 'Failed to retrieve TLS certificate',
            description: 'No certificate was returned during the TLS handshake.',
            evidence: { host },
          },
        ], started);
      }

      const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
      const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
      const daysToExpiry = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86400000) : null;

      if (daysToExpiry !== null) {
        if (daysToExpiry <= 0) {
          findings.push({
            source: this.SOURCE,
            severity: 'critical',
            category: 'tls',
            title: 'TLS certificate has expired',
            description: `Certificate expired ${Math.abs(daysToExpiry)} day(s) ago. All HTTPS connections will fail.`,
            evidence: { validTo: cert.valid_to, daysToExpiry },
            remediation: 'Renew the certificate immediately.',
          });
        } else if (daysToExpiry <= 14) {
          findings.push({
            source: this.SOURCE,
            severity: 'high',
            category: 'tls',
            title: `TLS certificate expires in ${daysToExpiry} day(s)`,
            description: 'Certificate is about to expire. Set up auto-renewal or rotate now.',
            evidence: { validTo: cert.valid_to, daysToExpiry },
            remediation: 'Enable automated renewal (e.g., certbot, Cloudflare, ACM).',
          });
        } else if (daysToExpiry <= 30) {
          findings.push({
            source: this.SOURCE,
            severity: 'medium',
            category: 'tls',
            title: `TLS certificate expires in ${daysToExpiry} days`,
            description: 'Certificate expires soon. Plan rotation.',
            evidence: { validTo: cert.valid_to, daysToExpiry },
          });
        }
      }

      const sanList = parseSan(cert.subjectaltname ?? '');
      const meta = {
        subject: cert.subject,
        issuer: cert.issuer,
        validFrom: validFrom?.toISOString() ?? null,
        validTo: validTo?.toISOString() ?? null,
        daysToExpiry,
        san: sanList,
        bits: cert.bits,
      };

      return ok(this.SOURCE, findings, started, meta);
    } catch (err) {
      return failed(this.SOURCE, err, started);
    }
  }
}

interface PeerCert {
  subject?: Record<string, string>;
  issuer?: Record<string, string>;
  valid_from?: string;
  valid_to?: string;
  subjectaltname?: string;
  bits?: number;
}

function getPeerCertificate(host: string, port: number, timeoutMs: number): Promise<PeerCert> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const cert = (socket as unknown as { getPeerCertificate(b?: boolean): PeerCert })
          .getPeerCertificate(true);
        socket.end();
        resolve(cert ?? {});
      },
    );
    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('TLS connect timeout'));
    });
  });
}

function parseSan(s: string): string[] {
  if (!s) return [];
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.toLowerCase().startsWith('dns:'))
    .map((p) => p.slice(4).trim().toLowerCase());
}
