import * as tls from 'tls';
import * as dns from 'dns/promises';
import * as net from 'net';
import { CheckResult } from '../demo-scan.types';

type CheckFn = (
  domain: string,
  headers: Record<string, string>,
  html: string,
  tlsInfo: any,
) => Promise<CheckResult>;

// ─── TLS helpers ─────────────────────────────────────────────────────────────

function getTlsInfo(domain: string): Promise<any> {
  return new Promise((resolve) => {
    const opts = { host: domain, port: 443, timeout: 10000, rejectUnauthorized: false };
    const sock = tls.connect(opts, () => {
      const cert = sock.getPeerCertificate(true);
      const proto = sock.getProtocol();
      const cipher = sock.getCipher();
      const session = sock.getSession();
      sock.destroy();
      resolve({ cert, proto, cipher, session, authorized: sock.authorized });
    });
    sock.on('error', () => resolve(null));
    sock.setTimeout(10000, () => { sock.destroy(); resolve(null); });
  });
}

// ─── Check: ssl_cert ─────────────────────────────────────────────────────────

const ssl_cert: CheckFn = async (domain, _h, _html, tlsInfo) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'ssl_cert',
    title: 'SSL Certificate Validity',
    severity: 'critical',
    category: 'tls',
  };
  if (!tlsInfo?.cert) return { ...base, status: 'fail', score: 0, detail: 'Could not retrieve TLS certificate' };
  const cert = tlsInfo.cert;
  if (!cert.valid_to) return { ...base, status: 'fail', score: 0, detail: 'Certificate has no expiry date' };
  const expiry = new Date(cert.valid_to);
  const now = new Date();
  const days = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (!tlsInfo.authorized && days < 0)
    return { ...base, status: 'fail', score: 0, detail: `Certificate expired ${Math.abs(days)} days ago` };
  if (days < 0)
    return { ...base, status: 'fail', score: 0, detail: `Certificate expired ${Math.abs(days)} days ago` };
  if (days < 15)
    return { ...base, status: 'fail', score: 2, detail: `Certificate expires in ${days} days (critical)` };
  if (days < 30)
    return { ...base, status: 'warn', score: 5, detail: `Certificate expires in ${days} days (warning)` };
  return { ...base, status: 'pass', score: 10, detail: `Certificate valid for ${days} more days` };
};

// ─── Check: hsts ─────────────────────────────────────────────────────────────

const hsts: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'hsts',
    title: 'HTTP Strict Transport Security',
    severity: 'high',
    category: 'tls',
  };
  const val = headers['strict-transport-security'];
  if (!val) return { ...base, status: 'fail', score: 0, detail: 'HSTS header not present' };
  const match = val.match(/max-age=(\d+)/i);
  if (!match) return { ...base, status: 'warn', score: 4, detail: 'HSTS header present but max-age not found' };
  const maxAge = parseInt(match[1], 10);
  if (maxAge < 31536000)
    return { ...base, status: 'warn', score: 6, detail: `HSTS max-age is ${maxAge}s (recommended ≥31536000)` };
  return { ...base, status: 'pass', score: 10, detail: `HSTS enabled with max-age=${maxAge}s` };
};

// ─── Check: https_redirect ───────────────────────────────────────────────────

const https_redirect: CheckFn = async (domain) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'https_redirect',
    title: 'HTTPS Redirect',
    severity: 'high',
    category: 'tls',
  };
  try {
    const http = await import('http');
    const redirected = await new Promise<boolean>((resolve) => {
      const req = http.get(`http://${domain}/`, { timeout: 8000 }, (res) => {
        const loc = res.headers.location || '';
        resolve(loc.startsWith('https://'));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (redirected) return { ...base, status: 'pass', score: 10, detail: 'HTTP traffic redirects to HTTPS' };
    return { ...base, status: 'fail', score: 0, detail: 'HTTP does not redirect to HTTPS' };
  } catch {
    return { ...base, status: 'warn', score: 5, detail: 'Could not verify HTTP redirect' };
  }
};

// ─── Check: tls_version ──────────────────────────────────────────────────────

const tls_version: CheckFn = async (_d, _h, _html, tlsInfo) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'tls_version',
    title: 'TLS Protocol Version',
    severity: 'high',
    category: 'tls',
  };
  if (!tlsInfo) return { ...base, status: 'error', score: 0, detail: 'Could not retrieve TLS info' };
  const proto = tlsInfo.proto || '';
  if (proto === 'TLSv1' || proto === 'TLSv1.1')
    return { ...base, status: 'fail', score: 0, detail: `Deprecated TLS version in use: ${proto}` };
  if (proto === 'TLSv1.2')
    return { ...base, status: 'pass', score: 8, detail: 'TLS 1.2 in use (TLS 1.3 preferred)' };
  if (proto === 'TLSv1.3')
    return { ...base, status: 'pass', score: 10, detail: 'TLS 1.3 in use (optimal)' };
  return { ...base, status: 'warn', score: 5, detail: `Unknown TLS version: ${proto}` };
};

// ─── Check: mixed_content ────────────────────────────────────────────────────

const mixed_content: CheckFn = async (_d, _h, html) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'mixed_content',
    title: 'Mixed Content',
    severity: 'medium',
    category: 'tls',
  };
  // Match src="http:// on non-anchor elements and href="http://" on non-anchor tags
  const srcMatches = (html.match(/(?:src|srcset)=["']http:\/\//gi) || []).length;
  const hrefMatches = (html.match(/<(?:link|script|img|iframe|video|audio|source|track)[^>]*href=["']http:\/\//gi) || []).length;
  const total = srcMatches + hrefMatches;
  if (total === 0) return { ...base, status: 'pass', score: 10, detail: 'No mixed content detected' };
  return { ...base, status: 'fail', score: 2, detail: `${total} mixed content reference(s) found` };
};

// ─── Check: ocsp_stapling ────────────────────────────────────────────────────

const ocsp_stapling: CheckFn = async (_d, _h, _html, tlsInfo) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'ocsp_stapling',
    title: 'OCSP Stapling',
    severity: 'low',
    category: 'tls',
  };
  if (!tlsInfo) return { ...base, status: 'error', score: 5, detail: 'Could not retrieve TLS info' };
  // Node TLS session has stapled OCSP if tlsInfo.session is present (heuristic)
  const cert = tlsInfo.cert;
  if (!cert) return { ...base, status: 'warn', score: 5, detail: 'Could not determine OCSP stapling status' };
  // Check if OCSP URL is present in cert
  const ocspUrl = cert.infoAccess?.['OCSP - URI']?.[0] || '';
  if (!ocspUrl) return { ...base, status: 'warn', score: 6, detail: 'No OCSP URI in certificate; stapling may not be supported' };
  return { ...base, status: 'info', score: 8, detail: `OCSP URI: ${ocspUrl} (stapling configured at server level)` };
};

// ─── Check: cert_expiry ──────────────────────────────────────────────────────

const cert_expiry: CheckFn = async (_d, _h, _html, tlsInfo) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'cert_expiry',
    title: 'Certificate Expiry',
    severity: 'high',
    category: 'tls',
  };
  if (!tlsInfo?.cert?.valid_to) return { ...base, status: 'error', score: 0, detail: 'Could not read certificate expiry' };
  const expiry = new Date(tlsInfo.cert.valid_to);
  const days = Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { ...base, status: 'fail', score: 0, detail: `Certificate expired ${Math.abs(days)} days ago` };
  if (days < 15) return { ...base, status: 'fail', score: 2, detail: `${days} days until expiry (renew immediately)` };
  if (days < 30) return { ...base, status: 'warn', score: 5, detail: `${days} days until expiry (renew soon)` };
  return { ...base, status: 'pass', score: 10, detail: `${days} days until expiry (expires ${expiry.toISOString().split('T')[0]})` };
};

// ─── Check: cipher_analysis ──────────────────────────────────────────────────

const cipher_analysis: CheckFn = async (_d, _h, _html, tlsInfo) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'cipher_analysis',
    title: 'Cipher Suite Analysis',
    severity: 'high',
    category: 'tls',
  };
  if (!tlsInfo?.cipher) return { ...base, status: 'error', score: 5, detail: 'Could not retrieve cipher info' };
  const name: string = tlsInfo.cipher.name || '';
  const weak = /NULL|RC4|DES|EXPORT|MD5|anon/i.test(name);
  if (weak) return { ...base, status: 'fail', score: 0, detail: `Weak cipher in use: ${name}` };
  if (/AES_128_GCM|AES_256_GCM|CHACHA20/i.test(name))
    return { ...base, status: 'pass', score: 10, detail: `Strong cipher: ${name}` };
  return { ...base, status: 'pass', score: 8, detail: `Cipher: ${name}` };
};

// ─── Check: caa_records ──────────────────────────────────────────────────────

const caa_records: CheckFn = async (domain) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'caa_records',
    title: 'CAA DNS Records',
    severity: 'medium',
    category: 'tls',
  };
  try {
    const records = await dns.resolve(domain, 'CAA' as any);
    if (records && (records as any[]).length > 0)
      return { ...base, status: 'pass', score: 10, detail: `${(records as any[]).length} CAA record(s) found` };
    return { ...base, status: 'fail', score: 4, detail: 'No CAA records — any CA can issue certificates for this domain' };
  } catch {
    return { ...base, status: 'fail', score: 4, detail: 'No CAA records found' };
  }
};

// ─── Security Headers ─────────────────────────────────────────────────────────

const csp_header: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'csp_header',
    title: 'Content Security Policy',
    severity: 'high',
    category: 'headers',
  };
  const val = headers['content-security-policy'];
  if (!val) return { ...base, status: 'fail', score: 0, detail: 'Content-Security-Policy header not present' };
  const hasUnsafe = /unsafe-inline|unsafe-eval/i.test(val);
  if (hasUnsafe) return { ...base, status: 'warn', score: 5, detail: 'CSP present but contains unsafe-inline or unsafe-eval' };
  return { ...base, status: 'pass', score: 10, detail: 'CSP header present and does not contain unsafe directives' };
};

const x_frame_options: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'x_frame_options',
    title: 'X-Frame-Options',
    severity: 'medium',
    category: 'headers',
  };
  const val = (headers['x-frame-options'] || '').toUpperCase();
  if (!val) return { ...base, status: 'fail', score: 0, detail: 'X-Frame-Options header not present' };
  if (val === 'DENY' || val === 'SAMEORIGIN')
    return { ...base, status: 'pass', score: 10, detail: `X-Frame-Options: ${val}` };
  return { ...base, status: 'warn', score: 5, detail: `X-Frame-Options has non-standard value: ${val}` };
};

const x_content_type: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'x_content_type',
    title: 'X-Content-Type-Options',
    severity: 'medium',
    category: 'headers',
  };
  const val = (headers['x-content-type-options'] || '').toLowerCase();
  if (val === 'nosniff') return { ...base, status: 'pass', score: 10, detail: 'X-Content-Type-Options: nosniff' };
  if (!val) return { ...base, status: 'fail', score: 0, detail: 'X-Content-Type-Options header not present' };
  return { ...base, status: 'warn', score: 5, detail: `Unexpected value: ${val}` };
};

const permissions_policy: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'permissions_policy',
    title: 'Permissions Policy',
    severity: 'low',
    category: 'headers',
  };
  const val = headers['permissions-policy'];
  if (!val) return { ...base, status: 'warn', score: 5, detail: 'Permissions-Policy header not present' };
  return { ...base, status: 'pass', score: 10, detail: `Permissions-Policy: ${val.slice(0, 120)}` };
};

const referrer_policy: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'referrer_policy',
    title: 'Referrer Policy',
    severity: 'medium',
    category: 'headers',
  };
  const val = headers['referrer-policy'];
  if (!val) return { ...base, status: 'fail', score: 3, detail: 'Referrer-Policy header not present' };
  const safe = ['no-referrer', 'strict-origin', 'strict-origin-when-cross-origin', 'same-origin'];
  const valLower = val.toLowerCase();
  if (safe.some(s => valLower.includes(s)))
    return { ...base, status: 'pass', score: 10, detail: `Referrer-Policy: ${val}` };
  if (valLower === 'no-referrer-when-downgrade' || valLower === 'origin')
    return { ...base, status: 'warn', score: 6, detail: `Referrer-Policy: ${val} (consider stricter policy)` };
  return { ...base, status: 'fail', score: 2, detail: `Unsafe Referrer-Policy: ${val}` };
};

const coop_header: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'coop_header',
    title: 'Cross-Origin-Opener-Policy',
    severity: 'medium',
    category: 'headers',
  };
  const val = headers['cross-origin-opener-policy'];
  if (!val) return { ...base, status: 'warn', score: 4, detail: 'Cross-Origin-Opener-Policy not set' };
  return { ...base, status: 'pass', score: 10, detail: `COOP: ${val}` };
};

const coep_header: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'coep_header',
    title: 'Cross-Origin-Embedder-Policy',
    severity: 'medium',
    category: 'headers',
  };
  const val = headers['cross-origin-embedder-policy'];
  if (!val) return { ...base, status: 'warn', score: 4, detail: 'Cross-Origin-Embedder-Policy not set' };
  return { ...base, status: 'pass', score: 10, detail: `COEP: ${val}` };
};

const x_xss_protection: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'x_xss_protection',
    title: 'X-XSS-Protection',
    severity: 'low',
    category: 'headers',
  };
  const val = headers['x-xss-protection'];
  if (!val) return { ...base, status: 'info', score: 8, detail: 'X-XSS-Protection not set (acceptable in modern browsers)' };
  if (val.trim() === '0') return { ...base, status: 'info', score: 8, detail: 'X-XSS-Protection: 0 (disabled — correct for modern browsers)' };
  return { ...base, status: 'warn', score: 5, detail: `X-XSS-Protection: ${val} — deprecated header, should be removed` };
};

const content_type_header: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'content_type_header',
    title: 'Content-Type with Charset',
    severity: 'low',
    category: 'headers',
  };
  const val = headers['content-type'] || '';
  if (!val) return { ...base, status: 'fail', score: 2, detail: 'Content-Type header missing' };
  if (/charset=/i.test(val)) return { ...base, status: 'pass', score: 10, detail: `Content-Type: ${val}` };
  return { ...base, status: 'warn', score: 6, detail: `Content-Type missing charset: ${val}` };
};

const server_disclosure: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'server_disclosure',
    title: 'Server Version Disclosure',
    severity: 'medium',
    category: 'headers',
  };
  const server = headers['server'] || '';
  const powered = headers['x-powered-by'] || '';
  const versionRe = /[\d]+\.[\d]+/;
  if (versionRe.test(server))
    return { ...base, status: 'fail', score: 2, detail: `Server header exposes version: ${server}` };
  if (versionRe.test(powered))
    return { ...base, status: 'fail', score: 2, detail: `X-Powered-By exposes version: ${powered}` };
  if (server || powered)
    return { ...base, status: 'warn', score: 7, detail: `Server info present but no version: ${server || powered}` };
  return { ...base, status: 'pass', score: 10, detail: 'No server version disclosed' };
};

// ─── Network Checks ───────────────────────────────────────────────────────────

const SCAN_PORTS = [21, 22, 23, 25, 80, 443, 3000, 8080, 8443, 9000];
const STANDARD_PORTS = new Set([80, 443]);

function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

const open_ports: CheckFn = async (domain) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'open_ports',
    title: 'Open Ports',
    severity: 'medium',
    category: 'network',
  };
  const results = await Promise.all(SCAN_PORTS.map(p => tcpProbe(domain, p).then(open => ({ port: p, open }))));
  const open = results.filter(r => r.open).map(r => r.port);
  const nonStandard = open.filter(p => !STANDARD_PORTS.has(p));
  if (nonStandard.length === 0)
    return { ...base, status: 'pass', score: 10, detail: `Open ports: ${open.join(', ') || 'none'} — only standard HTTP/HTTPS` };
  if (nonStandard.some(p => [21, 23].includes(p)))
    return { ...base, status: 'fail', score: 0, detail: `Dangerous ports open: ${nonStandard.join(', ')}` };
  return { ...base, status: 'warn', score: 5, detail: `Non-standard ports open: ${nonStandard.join(', ')}` };
};

const waf_detection: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'waf_detection',
    title: 'WAF Detection',
    severity: 'info',
    category: 'network',
  };
  const wafSignatures: [string, string | RegExp][] = [
    ['Cloudflare', /cf-ray/i],
    ['AWS CloudFront', /x-amz-cf-id/i],
    ['Sucuri', /x-sucuri-id/i],
    ['Akamai', /x-akamai/i],
    ['CDN', /x-cdn/i],
    ['Fastly', /x-fastly-request-id/i],
    ['Nginx WAF', /x-nginx-/i],
    ['Imperva', /x-iinfo/i],
  ];
  const headerKeys = Object.keys(headers).map(k => k.toLowerCase());
  for (const [wafName, pattern] of wafSignatures) {
    if (headerKeys.some(k => (typeof pattern === 'string' ? k === pattern : pattern.test(k)))) {
      return { ...base, status: 'info', score: 10, detail: `WAF/CDN detected: ${wafName}` };
    }
  }
  return { ...base, status: 'info', score: 8, detail: 'No WAF/CDN signatures detected' };
};

const TAKEOVER_PATTERNS = [
  /\.github\.io$/,
  /\.herokuapp\.com$/,
  /\.surge\.sh$/,
  /\.netlify\.app$/,
  /\.netlify\.com$/,
  /\.readthedocs\.io$/,
  /\.ghost\.io$/,
  /\.s3\.amazonaws\.com$/,
  /\.bitbucket\.io$/,
  /\.fastly\.net$/,
  /\.azurewebsites\.net$/,
];

const subdomain_takeover: CheckFn = async (domain) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'subdomain_takeover',
    title: 'Subdomain Takeover Risk',
    severity: 'high',
    category: 'network',
    gated: true,
  };
  try {
    const cnames = await dns.resolve(domain, 'CNAME').catch(() => []);
    if (!cnames.length)
      return { ...base, status: 'pass', score: 10, detail: 'No CNAME records (subdomain takeover not applicable)' };
    const riskyTarget = cnames.find(c => TAKEOVER_PATTERNS.some(p => p.test(c)));
    if (riskyTarget)
      return { ...base, status: 'warn', score: 3, detail: `CNAME points to potentially unclaimed service (upgrade to see details)` };
    return { ...base, status: 'pass', score: 10, detail: `CNAME target does not match known risky patterns` };
  } catch {
    return { ...base, status: 'info', score: 8, detail: 'Could not resolve CNAME' };
  }
};

const dns_security: CheckFn = async (domain) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'dns_security',
    title: 'DNS Security',
    severity: 'info',
    category: 'network',
  };
  const details: string[] = [];
  try {
    const caa = await dns.resolve(domain, 'CAA' as any).catch(() => []);
    if ((caa as any[]).length > 0) details.push('CAA records present');
    else details.push('No CAA records');
  } catch { details.push('CAA lookup failed'); }
  try {
    const wildcardA = await dns.resolve(`*.${domain}`, 'A').catch(() => []);
    if ((wildcardA as string[]).length > 0) details.push('Wildcard A record detected');
    else details.push('No wildcard A record');
  } catch { details.push('No wildcard A record'); }
  return { ...base, status: 'info', score: 8, detail: details.join('; ') };
};

// ─── Email Checks ─────────────────────────────────────────────────────────────

const spf_record: CheckFn = async (domain) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'spf_record',
    title: 'SPF Record',
    severity: 'high',
    category: 'email',
  };
  try {
    const txts = await dns.resolveTxt(domain);
    const spf = txts.flat().find(t => t.startsWith('v=spf1'));
    if (spf) return { ...base, status: 'pass', score: 10, detail: `SPF record found: ${spf.slice(0, 100)}` };
    return { ...base, status: 'fail', score: 0, detail: 'No SPF record found' };
  } catch {
    return { ...base, status: 'fail', score: 0, detail: 'Could not resolve DNS TXT records' };
  }
};

const dkim_record: CheckFn = async (domain) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'dkim_record',
    title: 'DKIM Record',
    severity: 'high',
    category: 'email',
  };
  const selectors = ['google._domainkey', 'default._domainkey', 'mail._domainkey', 'k1._domainkey'];
  for (const selector of selectors) {
    try {
      const txts = await dns.resolveTxt(`${selector}.${domain}`);
      const flat = txts.flat();
      if (flat.some(t => t.includes('v=DKIM1')))
        return { ...base, status: 'pass', score: 10, detail: `DKIM record found at ${selector}` };
    } catch { /* try next */ }
  }
  return { ...base, status: 'fail', score: 0, detail: 'No DKIM records found for common selectors' };
};

const dmarc_record: CheckFn = async (domain) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'dmarc_record',
    title: 'DMARC Record',
    severity: 'high',
    category: 'email',
  };
  try {
    const txts = await dns.resolveTxt(`_dmarc.${domain}`);
    const record = txts.flat().find(t => t.startsWith('v=DMARC1'));
    if (!record) return { ...base, status: 'fail', score: 0, detail: 'No DMARC record found' };
    const pMatch = record.match(/p=(\w+)/i);
    const policy = pMatch?.[1]?.toLowerCase();
    if (policy === 'reject') return { ...base, status: 'pass', score: 10, detail: `DMARC: p=reject (strongest)` };
    if (policy === 'quarantine') return { ...base, status: 'pass', score: 8, detail: `DMARC: p=quarantine` };
    if (policy === 'none') return { ...base, status: 'warn', score: 4, detail: 'DMARC present but p=none (monitoring only)' };
    return { ...base, status: 'warn', score: 5, detail: `DMARC found: ${record.slice(0, 100)}` };
  } catch {
    return { ...base, status: 'fail', score: 0, detail: 'No DMARC record found' };
  }
};

// ─── Application Checks ───────────────────────────────────────────────────────

const cookie_security: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'cookie_security',
    title: 'Cookie Security',
    severity: 'high',
    category: 'application',
  };
  const raw = headers['set-cookie'];
  if (!raw) return { ...base, status: 'info', score: 8, detail: 'No Set-Cookie headers on this response' };
  // set-cookie may be a string (lowercased header) or already split
  const cookies = Array.isArray(raw) ? raw : [raw];
  const issues: string[] = [];
  for (const cookie of cookies) {
    const name = cookie.split('=')[0].trim();
    if (!/HttpOnly/i.test(cookie)) issues.push(`${name}: missing HttpOnly`);
    if (!/Secure/i.test(cookie)) issues.push(`${name}: missing Secure`);
    if (!/SameSite/i.test(cookie)) issues.push(`${name}: missing SameSite`);
  }
  if (issues.length === 0)
    return { ...base, status: 'pass', score: 10, detail: `All ${cookies.length} cookie(s) have HttpOnly, Secure, and SameSite` };
  return { ...base, status: 'fail', score: 2, detail: issues.slice(0, 5).join('; ') };
};

const cors_policy: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'cors_policy',
    title: 'CORS Policy',
    severity: 'high',
    category: 'application',
  };
  const acao = headers['access-control-allow-origin'] || '';
  const acac = headers['access-control-allow-credentials'] || '';
  if (!acao) return { ...base, status: 'info', score: 8, detail: 'No CORS headers (acceptable for non-API pages)' };
  if (acao === '*' && acac.toLowerCase() === 'true')
    return { ...base, status: 'fail', score: 0, detail: 'Wildcard CORS with credentials=true — critical misconfiguration' };
  if (acao === '*')
    return { ...base, status: 'warn', score: 5, detail: 'CORS allows all origins (wildcard)' };
  return { ...base, status: 'pass', score: 10, detail: `CORS origin: ${acao}` };
};

const csrf_protection: CheckFn = async (_d, headers, html) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'csrf_protection',
    title: 'CSRF Protection',
    severity: 'medium',
    category: 'application',
  };
  const hasCsrfMeta = /<meta[^>]+(?:csrf|_token)[^>]*>/i.test(html);
  const hasCsrfInput = /<input[^>]+(?:csrf|_token)[^>]*>/i.test(html);
  const rawCookie = headers['set-cookie'] || '';
  const hasSameSite = /SameSite=(Strict|Lax)/i.test(rawCookie);
  if (hasCsrfMeta || hasCsrfInput)
    return { ...base, status: 'pass', score: 10, detail: 'CSRF token found in page' };
  if (hasSameSite)
    return { ...base, status: 'pass', score: 9, detail: 'SameSite cookies provide CSRF protection' };
  return { ...base, status: 'warn', score: 5, detail: 'No explicit CSRF token detected (may be handled client-side)' };
};

const clickjacking: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'clickjacking',
    title: 'Clickjacking Protection',
    severity: 'medium',
    category: 'application',
  };
  const xfo = (headers['x-frame-options'] || '').toUpperCase();
  const csp = headers['content-security-policy'] || '';
  const hasCspFrameAncestors = /frame-ancestors\s+(?!'\*')[^;]+/i.test(csp);
  const xfoGood = xfo === 'DENY' || xfo === 'SAMEORIGIN';
  if (hasCspFrameAncestors && xfoGood)
    return { ...base, status: 'pass', score: 10, detail: 'Protected by both CSP frame-ancestors and X-Frame-Options' };
  if (hasCspFrameAncestors)
    return { ...base, status: 'pass', score: 9, detail: 'CSP frame-ancestors configured' };
  if (xfoGood)
    return { ...base, status: 'pass', score: 8, detail: `X-Frame-Options: ${xfo} (add CSP frame-ancestors too)` };
  return { ...base, status: 'fail', score: 0, detail: 'No clickjacking protection (missing X-Frame-Options and CSP frame-ancestors)' };
};

const vulnerable_js_libs: CheckFn = async (_d, _h, html) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'vulnerable_js_libs',
    title: 'Vulnerable JavaScript Libraries',
    severity: 'high',
    category: 'application',
    gated: true,
  };
  const scriptSrcs = html.match(/<script[^>]+src=["'][^"']+["']/gi) || [];
  const findings: string[] = [];
  for (const tag of scriptSrcs) {
    if (/jquery[-/]([12]\.|3\.[0-4]\.)/i.test(tag)) findings.push('jQuery (vulnerable version)');
    if (/bootstrap[-/][0-3]\./i.test(tag)) findings.push('Bootstrap < 4 (vulnerable version)');
    if (/angular(?:js)?[-/]1\.[0-5]\./i.test(tag)) findings.push('AngularJS (vulnerable version)');
  }
  if (findings.length === 0)
    return { ...base, status: 'pass', score: 10, detail: 'No known vulnerable JS libraries detected in page source' };
  return { ...base, status: 'fail', score: 2, detail: `Vulnerable libraries detected (upgrade to see CVE details)` };
};

const cross_origin_isolation: CheckFn = async (_d, headers) => {
  const base: Omit<CheckResult, 'status' | 'score' | 'detail'> = {
    check: 'cross_origin_isolation',
    title: 'Cross-Origin Isolation',
    severity: 'medium',
    category: 'application',
  };
  const coop = headers['cross-origin-opener-policy'] || '';
  const coep = headers['cross-origin-embedder-policy'] || '';
  if (/same-origin/i.test(coop) && /require-corp|credentialless/i.test(coep))
    return { ...base, status: 'pass', score: 10, detail: `Cross-origin isolated: COOP=${coop}, COEP=${coep}` };
  if (coop || coep)
    return { ...base, status: 'warn', score: 5, detail: `Partially configured: COOP=${coop || 'missing'}, COEP=${coep || 'missing'}` };
  return { ...base, status: 'fail', score: 2, detail: 'Cross-origin isolation not configured (both COOP + COEP required)' };
};

// ─── Compliance Checks (derived) ──────────────────────────────────────────────

export function deriveComplianceChecks(results: CheckResult[]): CheckResult[] {
  const byId = new Map(results.map(r => [r.check, r]));
  const s = (id: string) => byId.get(id)?.status;
  const isPass = (id: string) => s(id) === 'pass';
  const score = (id: string) => byId.get(id)?.score ?? 0;

  const pciInputs = ['ssl_cert', 'hsts', 'https_redirect', 'cookie_security'];
  const pciPassed = pciInputs.filter(isPass).length;
  const pciScore = Math.round((pciPassed / pciInputs.length) * 100);

  const gdprInputs = ['cookie_security', 'referrer_policy', 'server_disclosure'];
  const gdprPassed = gdprInputs.filter(isPass).length;
  const gdprScore = Math.round((gdprPassed / gdprInputs.length) * 100);

  const hipaaInputs = ['ssl_cert', 'hsts', 'https_redirect'];
  const hipaaPassed = hipaaInputs.filter(isPass).length;
  const hipaaScore = Math.round((hipaaPassed / hipaaInputs.length) * 100);

  const allScores = results.filter(r => r.category !== 'compliance').map(r => r.score);
  const avgScore = allScores.length ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length * 10) : 50;

  return [
    {
      check: 'pci_dss_score',
      status: pciScore >= 75 ? 'pass' : pciScore >= 50 ? 'warn' : 'fail',
      score: Math.round(pciScore / 10),
      title: 'PCI DSS Compliance Score',
      detail: `Score: ${pciScore}/100 (upgrade to see detailed breakdown)`,
      severity: 'high',
      category: 'compliance',
      gated: true,
    },
    {
      check: 'gdpr_score',
      status: gdprScore >= 75 ? 'pass' : gdprScore >= 50 ? 'warn' : 'fail',
      score: Math.round(gdprScore / 10),
      title: 'GDPR Compliance Score',
      detail: `Score: ${gdprScore}/100 (upgrade to see detailed breakdown)`,
      severity: 'high',
      category: 'compliance',
      gated: true,
    },
    {
      check: 'hipaa_score',
      status: hipaaScore >= 75 ? 'pass' : hipaaScore >= 50 ? 'warn' : 'fail',
      score: Math.round(hipaaScore / 10),
      title: 'HIPAA Compliance Score',
      detail: `Score: ${hipaaScore}/100 (upgrade to see detailed breakdown)`,
      severity: 'high',
      category: 'compliance',
      gated: true,
    },
    {
      check: 'soc2_score',
      status: avgScore >= 75 ? 'pass' : avgScore >= 50 ? 'warn' : 'fail',
      score: Math.round(avgScore / 10),
      title: 'SOC 2 Compliance Score',
      detail: `Score: ${avgScore}/100 (upgrade to see detailed breakdown)`,
      severity: 'high',
      category: 'compliance',
      gated: true,
    },
  ];
}

// ─── Export all non-compliance checks ────────────────────────────────────────

export const checks: CheckFn[] = [
  ssl_cert,
  hsts,
  https_redirect,
  tls_version,
  mixed_content,
  ocsp_stapling,
  cert_expiry,
  cipher_analysis,
  caa_records,
  csp_header,
  x_frame_options,
  x_content_type,
  permissions_policy,
  referrer_policy,
  coop_header,
  coep_header,
  x_xss_protection,
  content_type_header,
  server_disclosure,
  open_ports,
  waf_detection,
  subdomain_takeover,
  dns_security,
  spf_record,
  dkim_record,
  dmarc_record,
  cookie_security,
  cors_policy,
  csrf_protection,
  clickjacking,
  vulnerable_js_libs,
  cross_origin_isolation,
];

export { getTlsInfo };
