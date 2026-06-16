/**
 * SSRF / private-range host guard (ACTIVE_SCAN_DESIGN.md §8 / §10).
 *
 * Used at THREE points in the active-scan flow:
 *   1. target add (hostname normalization + literal-IP / reserved-suffix block)
 *   2. scan request after DNS resolution
 *   3. worker after live re-resolution (worker side; this util documents the rule)
 *
 * Extends the demo scanner's `PRIVATE_IP_RE` into a reusable, IPv4+IPv6-aware
 * checker. Pure functions, no deps.
 */

import * as net from 'net';

/** RFC1918 + loopback + localhost (the demo scanner's original regex). */
export const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost)/i;

/** Hostname suffixes that must never be scanned. */
const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost'];

/** Cloud metadata IPs (link-local). */
const METADATA_IPS = new Set(['169.254.169.254', 'fd00:ec2::254']);

/**
 * Normalize a user-supplied target into a bare lowercase FQDN.
 * Strips scheme, port, path, trailing dot, surrounding whitespace.
 * Throws on empty / clearly-invalid input.
 */
export function normalizeHostname(input: string): string {
  let raw = (input ?? '').trim().toLowerCase();
  if (!raw) throw new Error('empty hostname');

  // Strip scheme.
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // Strip path / query / fragment.
  raw = raw.split('/')[0]!.split('?')[0]!.split('#')[0]!;
  // Strip userinfo.
  const at = raw.lastIndexOf('@');
  if (at >= 0) raw = raw.slice(at + 1);
  // Strip port (but keep IPv6 brackets intact for detection below).
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close >= 0) raw = raw.slice(1, close);
  } else if (raw.includes(':') && !raw.match(/:[0-9a-f]*:/i)) {
    // host:port (single colon, not IPv6)
    raw = raw.split(':')[0]!;
  }
  // Strip trailing dot.
  raw = raw.replace(/\.$/, '');
  if (!raw) throw new Error('empty hostname after normalization');
  return raw;
}

/** True if the value is an IPv4 or IPv6 literal. */
export function isIpLiteral(host: string): boolean {
  return net.isIP(host) !== 0;
}

/**
 * Returns a block-reason string if the IP is private/reserved/internal, else
 * null. Covers RFC1918, loopback, link-local (169.254/16, fe80::/10), CGNAT
 * (100.64/10), ULA (fc00::/7), multicast/reserved, and cloud metadata IPs.
 */
export function blockedIpReason(ip: string): string | null {
  const fam = net.isIP(ip);
  if (fam === 0) return null; // not an IP literal — caller handles hostnames

  if (METADATA_IPS.has(ip.toLowerCase())) return 'cloud metadata IP';

  if (fam === 4) {
    const octs = ip.split('.').map((n) => Number(n));
    const [a, b] = octs as [number, number, number, number];
    if (a === 10) return 'RFC1918 (10.0.0.0/8)';
    if (a === 172 && b >= 16 && b <= 31) return 'RFC1918 (172.16.0.0/12)';
    if (a === 192 && b === 168) return 'RFC1918 (192.168.0.0/16)';
    if (a === 127) return 'loopback (127.0.0.0/8)';
    if (a === 169 && b === 254) return 'link-local (169.254.0.0/16)';
    if (a === 100 && b >= 64 && b <= 127) return 'CGNAT (100.64.0.0/10)';
    if (a === 0) return 'reserved (0.0.0.0/8)';
    if (a >= 224) return 'multicast/reserved (>= 224.0.0.0)';
    return null;
  }

  // IPv6
  const v = ip.toLowerCase();
  if (v === '::1') return 'loopback (::1)';
  if (v === '::' || v === '::0') return 'unspecified (::)';
  if (v.startsWith('fe80')) return 'link-local (fe80::/10)';
  if (v.startsWith('fc') || v.startsWith('fd')) return 'ULA (fc00::/7)';
  if (v.startsWith('ff')) return 'multicast (ff00::/8)';
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check the embedded v4.
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blockedIpReason(mapped[1]!);
  return null;
}

/**
 * Validate a hostname for use as an active-scan target. Throws Error with a
 * human-readable message if it must be blocked. Returns the normalized host.
 *
 * Rejects: IP literals (must be a registrable domain), private/reserved IPs,
 * blocked suffixes (.internal/.local/.localhost), bare single-label hosts,
 * and the legacy `PRIVATE_IP_RE`.
 */
export function assertScannableHostname(input: string): string {
  const host = normalizeHostname(input);

  if (isIpLiteral(host)) {
    const reason = blockedIpReason(host);
    if (reason) throw new Error(`Target IP is not allowed: ${reason}`);
    throw new Error('Targets must be a registrable domain, not an IP literal');
  }

  if (PRIVATE_IP_RE.test(host)) {
    throw new Error('Scanning private/localhost addresses is not allowed');
  }

  for (const suffix of BLOCKED_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      throw new Error(`Hostnames ending in ${suffix} are not allowed`);
    }
  }

  // Must look like a domain (at least one dot, valid label chars).
  if (!host.includes('.')) {
    throw new Error('Target must be a fully-qualified domain (e.g. example.com)');
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.length > 253) {
    throw new Error('Invalid hostname');
  }

  return host;
}

/** Block a list of resolved IPs; returns the first block-reason or null. */
export function firstBlockedIp(ips: string[]): { ip: string; reason: string } | null {
  for (const ip of ips) {
    const reason = blockedIpReason(ip);
    if (reason) return { ip, reason };
  }
  return null;
}
