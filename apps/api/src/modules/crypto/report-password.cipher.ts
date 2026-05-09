import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { AppConfigService } from '../../config/config.service';

/**
 * Per-column AES-256-GCM helper for the encrypted-at-rest PDF password.
 *
 * Same KEK (`CREDS_ENCRYPTION_KEY`) as `EnvKeyCryptoService` — but stores
 * ciphertext / iv / tag as separate base64 strings so the database schema
 * can keep them in dedicated columns (`passwordCiphertext`, `passwordIv`,
 * `passwordTag`) per "PDF Password Policy (locked 2026-05-09)".
 *
 * AAD: a fixed string tying the ciphertext to its purpose (defence-in-depth
 * against blob reuse across modules).
 */
@Injectable()
export class ReportPasswordCipher {
  private readonly logger = new Logger(ReportPasswordCipher.name);
  private readonly key: Buffer;
  private static readonly AAD = Buffer.from('cs-platform:report-password:v1', 'utf8');

  constructor(cfg: AppConfigService) {
    const raw = cfg.get('CREDS_ENCRYPTION_KEY');
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      this.logger.warn(
        `CREDS_ENCRYPTION_KEY is not a 32-byte base64 string (got ${buf.length}). Using zero-pad fallback for dev only.`,
      );
      const padded = Buffer.alloc(32);
      buf.copy(padded, 0, 0, Math.min(buf.length, 32));
      this.key = padded;
    } else {
      this.key = buf;
    }
  }

  encrypt(plaintext: string): { ciphertext: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(ReportPasswordCipher.AAD);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: ct.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  decrypt(parts: { ciphertext: string; iv: string; tag: string }): string {
    const iv = Buffer.from(parts.iv, 'base64');
    const tag = Buffer.from(parts.tag, 'base64');
    const ct = Buffer.from(parts.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(ReportPasswordCipher.AAD);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }
}
