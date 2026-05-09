import * as crypto from 'crypto';

/**
 * Generate a URL-safe random token (default 32 bytes → ~43 chars base64url).
 * Plaintext is emailed to the user, only the sha256 hash is stored.
 */
export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
