export const STORAGE_SERVICE = 'StorageService';

export interface SignedUploadUrl {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface SignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

export interface StorageService {
  getUploadUrl(args: {
    key: string;
    contentType: string;
    contentLength?: number;
    ttlSec?: number;
  }): Promise<SignedUploadUrl>;

  getDownloadUrl(args: {
    key: string;
    ttlSec?: number;
    downloadFilename?: string;
  }): Promise<SignedDownloadUrl>;

  head(key: string): Promise<{ size: number; contentType: string } | null>;
  putObject(args: { key: string; body: Buffer | Uint8Array; contentType: string }): Promise<void>;
  /** Fetch the raw object bytes (server-side use only). */
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
