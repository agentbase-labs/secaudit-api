import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AppConfigService } from '../../config/config.service';
import type {
  SignedDownloadUrl,
  SignedUploadUrl,
  StorageService,
} from './storage.service';

/**
 * Dev-only fallback when R2 isn't configured. Backs every operation with a
 * temporary directory under `os.tmpdir()/cs-platform-storage`. Signed URLs
 * are `file://` paths — sufficient for local smoke tests where the API and
 * any consumer share the filesystem.
 *
 * NEVER select this in production — gated by `R2_ENDPOINT` being unset.
 */
@Injectable()
export class LocalDiskStorageService implements StorageService {
  private readonly logger = new Logger(LocalDiskStorageService.name);
  private readonly root: string;

  constructor(_cfg: AppConfigService) {
    this.root = path.join(os.tmpdir(), 'cs-platform-storage');
    void fs.mkdir(this.root, { recursive: true });
    this.logger.warn(
      `R2 not configured \u2014 using LocalDiskStorageService at ${this.root} (DEV ONLY).`,
    );
  }

  private fullPath(key: string): string {
    return path.join(this.root, key);
  }

  async getUploadUrl(args: {
    key: string;
    contentType: string;
    contentLength?: number;
    ttlSec?: number;
  }): Promise<SignedUploadUrl> {
    const ttl = args.ttlSec ?? 300;
    return {
      url: `file://${this.fullPath(args.key)}`,
      headers: { 'Content-Type': args.contentType },
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  async getDownloadUrl(args: {
    key: string;
    ttlSec?: number;
    downloadFilename?: string;
  }): Promise<SignedDownloadUrl> {
    const ttl = args.ttlSec ?? 60;
    return {
      url: `file://${this.fullPath(args.key)}`,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const st = await fs.stat(this.fullPath(key));
      return { size: st.size, contentType: 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async putObject(args: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<void> {
    const p = this.fullPath(args.key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, args.body);
  }

  async getObject(key: string): Promise<Buffer> {
    return fs.readFile(this.fullPath(key));
  }

  async deleteObject(key: string): Promise<void> {
    await fs.rm(this.fullPath(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }
}
