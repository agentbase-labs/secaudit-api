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
 * HTTP fingerprint scanner — fetches the target URL and inspects:
 *  - Status / redirects / response time
 *  - Security headers (CSP, HSTS, X-Frame-Options, ...)
 *  - Server / X-Powered-By / generator meta
 *  - Cookies (HttpOnly, Secure, SameSite flags)
 *  - Mixed content (http:// in https:// page)
 *  - robots.txt, sitemap.xml, .well-known/security.txt
 *  - Common exposed paths (HEAD-only): /.git/HEAD, /.env, /admin, ...
 *
 * Read-only, GET/HEAD only. 100ms inter-request delay between path probes.
 */
@Injectable()
export class HttpFingerprintScanner {
  private readonly SOURCE = 'http_fingerprint' as const;

  // Risky paths to probe (HEAD only). Finding only logged on 200 / 301 / 302.
  private readonly EXPOSED_PATHS = [
    { path: '/.git/HEAD', severity: 'high' as const, title: '.git directory exposed' },
    { path: '/.git/config', severity: 'high' as const, title: '.git config exposed' },
    { path: '/.env', severity: 'critical' as const, title: '.env file exposed' },
    { path: '/.DS_Store', severity: 'low' as const, title: '.DS_Store exposed' },
    { path: '/wp-admin/', severity: 'info' as const, title: 'WordPress admin panel detected' },
    { path: '/admin', severity: 'info' as const, title: 'Generic /admin path responds' },
    { path: '/server-status', severity: 'medium' as const, title: 'Apache server-status exposed' },
    { path: '/server-info', severity: 'medium' as const, title: 'Apache server-info exposed' },
    { path: '/phpinfo.php', severity: 'high' as const, title: 'phpinfo() exposed' },
    { path: '/.well-known/security.txt', severity: 'info' as const, title: 'security.txt present', positive: true },
  ];

  async scan(ctx: ScannerContext): Promise<ScannerResult> {
    const started = Date.now();
    try {
      const findings: ScannerFinding[] = [];
      const { target } = ctx;

      // 1) Main page
      const mainStart = Date.now();
      const res = await fetchWithTimeout(target.url, {
        method: 'GET',
        headers: { 'User-Agent': 'secaudit-recon/1.0 (+https://secaudit.xyz)' },
        timeoutMs: 20000,
      });
      const responseTimeMs = Date.now() - mainStart;
      const html = await res.text().catch(() => '');
      const headers = headersToObject(res.headers);

      // 2) Security headers
      this.checkSecurityHeaders(target.url, headers, findings);

      // 3) Cookies
      this.checkCookies(headers, findings);

      // 4) Mixed content
      this.checkMixedContent(target.url, html, findings);

      // 5) Server fingerprint (info-level)
      this.fingerprintServer(headers, html, findings);

      // 6) robots.txt + sitemap
      await this.checkWellKnownFiles(target, findings);

      // 7) Exposed paths
      await this.probeExposedPaths(target, findings);

      const meta = {
        statusCode: res.status,
        finalUrl: res.url,
        responseTimeMs,
        redirected: res.redirected,
      };
      return ok(this.SOURCE, findings, started, meta);
    } catch (err) {
      return failed(this.SOURCE, err, started);
    }
  }

  private checkSecurityHeaders(
    url: string,
    headers: Record<string, string>,
    findings: ScannerFinding[],
  ): void {
    const isHttps = url.startsWith('https://');

    // CSP
    if (!headers['content-security-policy']) {
      findings.push({
        source: this.SOURCE,
        severity: 'medium',
        category: 'header',
        title: 'Missing Content-Security-Policy header',
        description:
          'CSP mitigates XSS, clickjacking, and other content-injection attacks. Recommended for any site that ' +
          'renders user-controlled HTML or includes third-party scripts.',
        evidence: { header: 'Content-Security-Policy', present: false },
        remediation:
          'Add a Content-Security-Policy header. Start with `default-src \'self\'` and tighten from there.',
        referenceUrls: ['https://owasp.org/www-community/attacks/Content_Security_Policy'],
      });
    }

    // HSTS (https only)
    if (isHttps && !headers['strict-transport-security']) {
      findings.push({
        source: this.SOURCE,
        severity: 'medium',
        category: 'header',
        title: 'Missing Strict-Transport-Security (HSTS) header',
        description:
          'HSTS instructs browsers to only ever connect over HTTPS, mitigating SSL-strip attacks.',
        evidence: { header: 'Strict-Transport-Security', present: false },
        remediation:
          'Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` (consider `preload` once stable).',
        referenceUrls: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security'],
      });
    }

    // X-Frame-Options OR CSP frame-ancestors
    const csp = headers['content-security-policy'] ?? '';
    if (!headers['x-frame-options'] && !/frame-ancestors/i.test(csp)) {
      findings.push({
        source: this.SOURCE,
        severity: 'low',
        category: 'header',
        title: 'Missing X-Frame-Options / frame-ancestors',
        description: 'No clickjacking protection. Pages can be embedded in iframes by any origin.',
        evidence: { header: 'X-Frame-Options', present: false },
        remediation: 'Add `X-Frame-Options: DENY` or use CSP `frame-ancestors \'none\'`.',
        referenceUrls: ['https://owasp.org/www-community/attacks/Clickjacking'],
      });
    }

    // X-Content-Type-Options
    if (!headers['x-content-type-options']) {
      findings.push({
        source: this.SOURCE,
        severity: 'low',
        category: 'header',
        title: 'Missing X-Content-Type-Options header',
        description: 'Browsers may MIME-sniff responses, allowing certain content-injection attacks.',
        evidence: { header: 'X-Content-Type-Options', present: false },
        remediation: 'Add `X-Content-Type-Options: nosniff`.',
      });
    }

    // Referrer-Policy
    if (!headers['referrer-policy']) {
      findings.push({
        source: this.SOURCE,
        severity: 'info',
        category: 'header',
        title: 'Missing Referrer-Policy header',
        description: 'Default browser referrer policies may leak sensitive URLs to third parties.',
        evidence: { header: 'Referrer-Policy', present: false },
        remediation: 'Add e.g. `Referrer-Policy: strict-origin-when-cross-origin`.',
      });
    }

    // Permissions-Policy
    if (!headers['permissions-policy']) {
      findings.push({
        source: this.SOURCE,
        severity: 'info',
        category: 'header',
        title: 'Missing Permissions-Policy header',
        description: 'No explicit policy for browser feature access (camera, mic, geolocation, etc.).',
        evidence: { header: 'Permissions-Policy', present: false },
        remediation: 'Add a Permissions-Policy header that explicitly disables features the site does not use.',
      });
    }
  }

  private checkCookies(headers: Record<string, string>, findings: ScannerFinding[]): void {
    const setCookie = headers['set-cookie'];
    if (!setCookie) return;
    const cookies = setCookie.split(/,(?=\s*\w+=)/);
    for (const cookie of cookies) {
      const name = cookie.split('=')[0]?.trim() ?? 'cookie';
      const lower = cookie.toLowerCase();
      const flags = {
        httpOnly: /;\s*httponly/i.test(cookie),
        secure: /;\s*secure/i.test(cookie),
        sameSite: /;\s*samesite=/i.test(cookie),
      };
      const missing: string[] = [];
      if (!flags.httpOnly) missing.push('HttpOnly');
      if (!flags.secure) missing.push('Secure');
      if (!flags.sameSite) missing.push('SameSite');
      if (missing.length === 0) continue;
      findings.push({
        source: this.SOURCE,
        severity: missing.includes('HttpOnly') || missing.includes('Secure') ? 'medium' : 'low',
        category: 'cookie',
        title: `Cookie "${name}" missing flag(s): ${missing.join(', ')}`,
        description: 'Cookies without these flags can be stolen via XSS, transmitted over plaintext, or used in CSRF attacks.',
        evidence: { cookie: cookie.split(';')[0], missingFlags: missing, hasFlags: flags },
        remediation: 'Add `HttpOnly`, `Secure`, and `SameSite=Lax` (or Strict) to all session-bearing cookies.',
        referenceUrls: ['https://owasp.org/www-community/HttpOnly'],
      });
      // de-dupe: only check the first low-flag cookie to avoid noise
      if (lower.includes('session') || lower.includes('auth') || lower.includes('jwt')) break;
    }
  }

  private checkMixedContent(url: string, html: string, findings: ScannerFinding[]): void {
    if (!url.startsWith('https://') || !html) return;
    const httpResources = html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+["']/gi);
    if (httpResources && httpResources.length > 0) {
      findings.push({
        source: this.SOURCE,
        severity: 'medium',
        category: 'misconfig',
        title: 'Mixed content: http:// resources loaded on https:// page',
        description:
          'Loading subresources over plaintext on a secure page weakens TLS guarantees and may be blocked by modern browsers.',
        evidence: { sample: httpResources.slice(0, 5), totalCount: httpResources.length },
        remediation: 'Update all <script>, <img>, <link>, <iframe> URLs to https:// or use protocol-relative URLs.',
      });
    }
  }

  private fingerprintServer(
    headers: Record<string, string>,
    html: string,
    findings: ScannerFinding[],
  ): void {
    const server = headers['server'];
    const poweredBy = headers['x-powered-by'];
    const generator = html.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/i)?.[1];
    if (server || poweredBy || generator) {
      findings.push({
        source: this.SOURCE,
        severity: 'info',
        category: 'fingerprint',
        title: 'Server software disclosed',
        description: 'Server / framework versions exposed via HTTP headers or HTML meta tags. Useful for attackers in CVE lookup.',
        evidence: { server, poweredBy, generator },
        remediation:
          'Strip or genericize `Server`, `X-Powered-By`, and `<meta name="generator">` to reduce attacker reconnaissance.',
      });
    }
  }

  private async checkWellKnownFiles(
    target: { url: string },
    findings: ScannerFinding[],
  ): Promise<void> {
    const base = new URL(target.url);
    const checks = [
      { path: '/robots.txt', expected: true, severity: 'info' as const, title: 'robots.txt present' },
      { path: '/sitemap.xml', expected: true, severity: 'info' as const, title: 'sitemap.xml present' },
      {
        path: '/.well-known/security.txt',
        expected: true,
        severity: 'low' as const,
        title: 'No security.txt found',
        invertOnAbsent: true,
      },
    ];
    for (const c of checks) {
      try {
        const u = new URL(c.path, base.origin).toString();
        const res = await fetchWithTimeout(u, {
          method: 'HEAD',
          timeoutMs: 8000,
        });
        await sleep(100);
        if (c.invertOnAbsent && res.status >= 400) {
          findings.push({
            source: this.SOURCE,
            severity: c.severity,
            category: 'misconfig',
            title: c.title,
            description:
              'security.txt provides a standard way for security researchers to report vulnerabilities. ' +
              'Absent file is a missed opportunity, not strictly a vulnerability.',
            evidence: { path: c.path, status: res.status },
            remediation: 'Publish /.well-known/security.txt with a contact email and policy URL.',
            referenceUrls: ['https://securitytxt.org/'],
          });
        }
      } catch {
        // ignore — network noise on these is normal
      }
    }
  }

  private async probeExposedPaths(
    target: { url: string },
    findings: ScannerFinding[],
  ): Promise<void> {
    const base = new URL(target.url);
    for (const probe of this.EXPOSED_PATHS) {
      try {
        const u = new URL(probe.path, base.origin).toString();
        const res = await fetchWithTimeout(u, {
          method: 'HEAD',
          timeoutMs: 6000,
          // Don't follow redirects so /admin → /login isn't reported as exposed
          redirect: 'manual',
        });
        await sleep(100);
        const status = res.status;
        // For positive findings (security.txt), 200 is good — already handled above.
        if (probe.positive) continue;
        if (status === 200 || status === 301) {
          findings.push({
            source: this.SOURCE,
            severity: probe.severity,
            category: 'exposure',
            title: probe.title,
            description: `Path ${probe.path} returned status ${status}. This may indicate misconfigured access control or sensitive data exposure.`,
            evidence: { path: probe.path, status },
            remediation: `Restrict access to ${probe.path} or remove the file from the web root.`,
          });
        }
      } catch {
        // ignore connection errors / DNS errors per-probe
      }
    }
  }
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
