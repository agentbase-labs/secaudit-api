import {
  assertScannableHostname,
  blockedIpReason,
  firstBlockedIp,
  isIpLiteral,
  normalizeHostname,
} from './host-guard';

/**
 * Unit tests for the SSRF / private-range host guard (ACTIVE_SCAN_DESIGN.md
 * §8 / §10). Pure functions — no network, no DB.
 */
describe('host-guard', () => {
  describe('normalizeHostname', () => {
    it('strips scheme, path, port, trailing dot, and lowercases', () => {
      expect(normalizeHostname('HTTPS://Example.com:8443/foo?x=1#y')).toBe('example.com');
      expect(normalizeHostname('http://sub.example.com/')).toBe('sub.example.com');
      expect(normalizeHostname('example.com.')).toBe('example.com');
      expect(normalizeHostname('  Example.COM  ')).toBe('example.com');
    });

    it('strips userinfo', () => {
      expect(normalizeHostname('https://user:pass@example.com/path')).toBe('example.com');
    });

    it('throws on empty input', () => {
      expect(() => normalizeHostname('')).toThrow();
      expect(() => normalizeHostname('   ')).toThrow();
    });
  });

  describe('isIpLiteral', () => {
    it('detects IPv4 + IPv6', () => {
      expect(isIpLiteral('93.184.216.34')).toBe(true);
      expect(isIpLiteral('2606:2800:220:1:248:1893:25c8:1946')).toBe(true);
      expect(isIpLiteral('example.com')).toBe(false);
    });
  });

  describe('blockedIpReason', () => {
    it.each([
      ['10.0.0.5', /RFC1918/],
      ['172.16.0.1', /RFC1918/],
      ['172.31.255.255', /RFC1918/],
      ['192.168.1.1', /RFC1918/],
      ['127.0.0.1', /loopback/],
      ['169.254.0.5', /link-local/],
      ['169.254.169.254', /metadata/],
      ['100.64.0.1', /CGNAT/],
      ['0.0.0.0', /reserved/],
      ['224.0.0.1', /multicast/],
      ['::1', /loopback/],
      ['fe80::1', /link-local/],
      ['fc00::1', /ULA/],
      ['fd12:3456::1', /ULA/],
    ])('blocks %s', (ip, re) => {
      expect(blockedIpReason(ip)).toMatch(re as RegExp);
    });

    it('allows public IPs', () => {
      expect(blockedIpReason('93.184.216.34')).toBeNull();
      expect(blockedIpReason('8.8.8.8')).toBeNull();
      expect(blockedIpReason('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
    });

    it('catches IPv4-mapped IPv6 internal addresses', () => {
      expect(blockedIpReason('::ffff:10.0.0.1')).toMatch(/RFC1918/);
    });

    it('returns null for non-IP input (hostnames handled elsewhere)', () => {
      expect(blockedIpReason('example.com')).toBeNull();
    });
  });

  describe('assertScannableHostname', () => {
    it('accepts a normal registrable domain', () => {
      expect(assertScannableHostname('https://Example.com')).toBe('example.com');
      expect(assertScannableHostname('app.example.co.uk')).toBe('app.example.co.uk');
    });

    it('rejects IP literals', () => {
      expect(() => assertScannableHostname('93.184.216.34')).toThrow(/IP literal/);
      expect(() => assertScannableHostname('10.0.0.1')).toThrow(/not allowed/);
    });

    it('rejects private / localhost / internal suffixes', () => {
      expect(() => assertScannableHostname('localhost')).toThrow();
      expect(() => assertScannableHostname('foo.internal')).toThrow(/\.internal/);
      expect(() => assertScannableHostname('db.local')).toThrow(/\.local/);
    });

    it('rejects single-label hosts (no dot)', () => {
      expect(() => assertScannableHostname('intranet')).toThrow(/fully-qualified/);
    });

    it('rejects invalid characters', () => {
      expect(() => assertScannableHostname('exa mple.com')).toThrow();
    });
  });

  describe('firstBlockedIp', () => {
    it('returns the first blocked IP in a list', () => {
      const r = firstBlockedIp(['93.184.216.34', '10.0.0.1', '8.8.8.8']);
      expect(r).toEqual({ ip: '10.0.0.1', reason: expect.stringMatching(/RFC1918/) });
    });
    it('returns null when all public', () => {
      expect(firstBlockedIp(['93.184.216.34', '8.8.8.8'])).toBeNull();
    });
  });
});
