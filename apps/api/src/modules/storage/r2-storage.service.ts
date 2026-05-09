import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../../config/config.service';
import type {
  SignedDownloadUrl,
  SignedUploadUrl,
  StorageService,
} from './storage.service';

@Injectable()
export class R2StorageService implements StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly configured: boolean;

  constructor(private readonly cfg: AppConfigService) {
    const endpoint = cfg.get('R2_ENDPOINT');
    const accessKeyId = cfg.get('R2_ACCESS_KEY_ID');
    const secretAccessKey = cfg.get('R2_SECRET_ACCESS_KEY');
    this.bucket = cfg.get('R2_BUCKET');
    this.configured = Boolean(endpoint && accessKeyId && secretAccessKey && this.bucket);

    if (!this.configured) {
      this.logger.warn(
        'R2 not fully configured; Storage calls will no-op. Set R2_* envs for live uploads.',
      );
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: endpoint || 'https://example.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: accessKeyId || 'dev',
        secretAccessKey: secretAccessKey || 'dev',
      },
      forcePathStyle: true,
    });
  }

  async getUploadUrl(args: {
    key: string;
    contentType: string;
    contentLength?: number;
    ttlSec?: number;
  }): Promise<SignedUploadUrl> {
    const ttl = args.ttlSec ?? 300;
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: args.key,
      ContentType: args.contentType,
      ContentLength: args.contentLength,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttl });
    return {
      url,
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
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: args.key,
      ResponseContentDisposition: args.downloadFilename
        ? `attachment; filename="${args.downloadFilename.replace(/"/g, '')}"`
        : undefined,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttl });
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: Number(res.ContentLength ?? 0),
        contentType: String(res.ContentType ?? 'application/octet-stream'),
      };
    } catch {
      return null;
    }
  }

  async putObject(args: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: args.key,
        Body: args.body,
        ContentType: args.contentType,
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = res.Body as Readable | undefined;
    if (!body) throw new Error(`getObject: empty body for ${key}`);
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }
}
