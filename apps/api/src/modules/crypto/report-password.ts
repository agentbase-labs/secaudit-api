import { randomBytes } from 'crypto';

/**
 * Cryptographically random 16-character alphanumeric (base62) password.
 *
 * Per "PDF Password Policy (locked 2026-05-09)" in design/05-r2-and-email.md:
 * 16 chars, alphanumeric, generated via crypto.randomBytes (no Math.random).
 *
 * Pure + deterministic given the same RNG → easy to unit-test by mocking
 * `crypto.randomBytes`.
 */
export const REPORT_PASSWORD_LENGTH = 16;

const BASE62_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateReportPassword(length: number = REPORT_PASSWORD_LENGTH): string {
  if (length <= 0) {
    throw new Error('generateReportPassword: length must be > 0');
  }
  // Oversample to keep modulo bias negligible. 62 fits cleanly in 6 bits;
  // we draw 1 byte per char and accept-reject (>= 248 = 4 * 62).
  const out: string[] = [];
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i]!;
      if (b < 248) {
        out.push(BASE62_ALPHABET[b % 62]!);
      }
    }
  }
  return out.join('');
}
