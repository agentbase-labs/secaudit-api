import * as crypto from 'crypto';

/**
 * Generate a 16-char-ish URL-safe password (~96 bits entropy).
 * Sent once via email — never shown again.
 */
export function generatePdfPassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}
