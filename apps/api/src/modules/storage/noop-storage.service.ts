import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  SignedDownloadUrl,
  SignedUploadUrl,
  StorageService,
} from './storage.service';

/**
 * Production fallback when no object-storage backend is configured.
 *
 * The API still boots cleanly so that auth and the rest of the platform
 * stay reachable — but every storage call surfaces a clean 503 with an
 * actionable message instead of silently writing to the container's
 * ephemeral disk (which would happen with `LocalDiskStorageService`).
 *
 * Selected by `StorageModule` when `NODE_ENV === 'production'` and the
 * R2 env vars are missing/empty.
 */
@Injectable()
export class NoOpStorageService implements StorageService {
  private readonly logger = new Logger(NoOpStorageService.name);

  constructor() {
    this.logger.warn(
      'R2 object storage is NOT configured. File upload/download endpoints ' +
        'will respond with HTTP 503 (ServiceUnavailable). Set R2_* envs to ' +
        'enable storage.',
    );
  }

  private fail(): never {
    throw new ServiceUnavailableException({
      error: 'STORAGE_NOT_CONFIGURED',
      message:
        'Object storage (R2) is not configured on this deployment. Uploads ' +
        'and downloads are temporarily unavailable.',
    });
  }

  async getUploadUrl(_args: {
    key: string;
    contentType: string;
    contentLength?: number;
    ttlSec?: number;
  }): Promise<SignedUploadUrl> {
    this.fail();
  }

  async getDownloadUrl(_args: {
    key: string;
    ttlSec?: number;
    downloadFilename?: string;
  }): Promise<SignedDownloadUrl> {
    this.fail();
  }

  async head(_key: string): Promise<{ size: number; contentType: string } | null> {
    return null;
  }

  async putObject(_args: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<void> {
    this.fail();
  }

  async getObject(_key: string): Promise<Buffer> {
    this.fail();
  }

  async deleteObject(_key: string): Promise<void> {
    // Idempotent no-op: deletes against a non-configured backend should
    // not blow up callers (e.g. cleanup crons).
    return;
  }

  async exists(_key: string): Promise<boolean> {
    return false;
  }
}
