/**
 * CryptoService interface — envelope AES-256-GCM in MVP, KMS adapter in Phase 2.
 * Token is a string token for DI (no runtime class for the interface).
 */
export const CRYPTO_SERVICE = 'CryptoService';

export interface CryptoService {
  encrypt(plaintext: string, context?: Record<string, string>): Promise<string>;
  decrypt(blob: string, context?: Record<string, string>): Promise<string>;
}
