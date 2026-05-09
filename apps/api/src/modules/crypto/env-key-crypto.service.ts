import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { AppConfigService } from '../../config/config.service';
import type { CryptoService } from './crypto.service';

interface EncryptedBlob {
  v: 1;
  ct: string; // base64 ciphertext
  iv: string; // base64 iv
  tag: string; // base64 auth tag
  aad?: string; // base64 aad (if context provided)
}

@Injectable()
export class EnvKeyCryptoService implements CryptoService {
  private readonly logger = new Logger(EnvKeyCryptoService.name);
  private readonly key: Buffer;

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

  async encrypt(plaintext: string, context?: Record<string, string>): Promise<string> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const aadStr = context ? JSON.stringify(context) : '';
    if (aadStr) cipher.setAAD(Buffer.from(aadStr, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob: EncryptedBlob = {
      v: 1,
      ct: ct.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ...(aadStr ? { aad: Buffer.from(aadStr, 'utf8').toString('base64') } : {}),
    };
    return JSON.stringify(blob);
  }

  async decrypt(blobStr: string, context?: Record<string, string>): Promise<string> {
    const blob = JSON.parse(blobStr) as EncryptedBlob;
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const ct = Buffer.from(blob.ct, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    const aadStr = context ? JSON.stringify(context) : blob.aad ? Buffer.from(blob.aad, 'base64').toString('utf8') : '';
    if (aadStr) decipher.setAAD(Buffer.from(aadStr, 'utf8'));
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }
}
