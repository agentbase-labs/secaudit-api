import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  AdminRequestDetail,
  ApiErrorCodes,
  AssetType,
  CreateRequestSchema,
  PublicUser,
  RequestDetail,
  RequestStatus,
  RequestSummary,
  SignedUploadUrlResponse,
  TestingType,
  detailsSchemaForAssetType,
} from '@cs-platform/shared';

import { STORAGE_SERVICE } from '../storage/storage.service';
import type { StorageService } from '../storage/storage.service';
import { CRYPTO_SERVICE } from '../crypto/crypto.service';
import type { CryptoService } from '../crypto/crypto.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import type { MailService } from '../mail/mail.service';
import { AppConfigService } from '../../config/config.service';
import { TestingRequest } from './entities/testing-request.entity';
import { Report } from '../reports/entities/report.entity';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { AutoScanService } from '../auto-scan/auto-scan.service';

type DetailsWithOptionalLogin = {
  login?: { username: string; password: string; notes?: string };
  [k: string]: unknown;
};

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    @InjectRepository(TestingRequest) private readonly repo: Repository<TestingRequest>,
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Inject(CRYPTO_SERVICE) private readonly crypto: CryptoService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly cfg: AppConfigService,
    @Inject(forwardRef(() => AutoScanService))
    private readonly autoScan: AutoScanService,
  ) {}

  // ---------------- Client ----------------

  async create(
    user: PublicUser,
    input: { assetType: AssetType; testingType: TestingType; details: Record<string, unknown> },
    ip: string | null,
  ): Promise<{ id: string; status: RequestStatus }> {
    const parsed = CreateRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Invalid request payload',
        details: parsed.error.issues,
      });
    }
    const details = await this.maybeEncryptLogin(parsed.data.details as DetailsWithOptionalLogin);
    const row = await this.repo.save(
      this.repo.create({
        userId: user.id,
        assetType: parsed.data.assetType,
        testingType: parsed.data.testingType,
        status: RequestStatus.SUBMITTED,
        details,
      }),
    );

    await this.audit.record({
      actorUserId: user.id,
      action: 'request.create',
      targetType: 'TestingRequest',
      targetId: row.id,
      ip,
      meta: { assetType: row.assetType, testingType: row.testingType },
    });

    // TODO(phase1): optionally send "request-received" email (low priority for MVP).
    void this.mail
      .sendTemplate({
        to: user.email,
        template: 'request-received',
        data: {
          fullName: user.fullName,
          requestId: row.id,
          assetType: row.assetType,
          dashboardUrl: `${this.cfg.get('APP_URL')}/dashboard/requests/${row.id}`,
        },
      })
      .catch(() => undefined);

    // Auto-scan: phase 1 — fire and forget background scan for website
    // requests when the feature flag is on.
    if (this.cfg.get('FEATURES_AUTOSCAN') && parsed.data.assetType === 'website') {
      const url =
        typeof (parsed.data.details as { url?: unknown })?.url === 'string'
          ? ((parsed.data.details as { url: string }).url)
          : null;
      if (url) {
        this.autoScan.runScan(row.id, url).catch((err) => {
          this.logger.warn(`auto-scan trigger failed for ${row.id}: ${(err as Error).message}`);
        });
      }
    }

    return { id: row.id, status: row.status };
  }

  async listForUser(
    userId: string,
    q: { status?: RequestStatus; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where = { userId, ...(q.status ? { status: q.status } : {}) };
    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const ids = rows.map((r) => r.id);
    const reportCounts = ids.length
      ? await this.reportRepo
          .createQueryBuilder('rep')
          .select('rep."requestId"', 'requestId')
          .addSelect('COUNT(*)', 'cnt')
          .where('rep."requestId" IN (:...ids)', { ids })
          .groupBy('rep."requestId"')
          .getRawMany<{ requestId: string; cnt: string }>()
      : [];
    const countMap = new Map(reportCounts.map((r) => [r.requestId, Number(r.cnt)]));
    const items: RequestSummary[] = rows.map((r) => ({
      id: r.id,
      assetType: r.assetType,
      testingType: r.testingType,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      hasReport: (countMap.get(r.id) ?? 0) > 0,
    }));
    return { items, page, pageSize, total };
  }

  async getForUser(userId: string, id: string): Promise<RequestDetail> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    const reports = await this.reportRepo.find({
      where: { requestId: id },
      order: { uploadedAt: 'DESC' },
    });
    return {
      id: row.id,
      assetType: row.assetType,
      testingType: row.testingType,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      hasReport: reports.length > 0,
      details: await this.redactDetails(row.details as Record<string, unknown>),
      reports: reports.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        fileSize: String(r.fileSize),
        uploadedAt: r.uploadedAt.toISOString(),
        downloadCount: r.downloadCount,
        lastDownloadedAt: r.lastDownloadedAt?.toISOString() ?? null,
      })),
    } as RequestDetail;
  }

  async patchForUser(
    userId: string,
    id: string,
    patch: { details?: Record<string, unknown> },
  ): Promise<RequestDetail> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    if (row.status !== RequestStatus.SUBMITTED) {
      throw new ConflictException({
        error: ApiErrorCodes.REQUEST_LOCKED,
        message: 'Request locked after submission',
      });
    }
    if (!patch.details || Object.keys(patch.details).length === 0) {
      throw new BadRequestException({
        error: ApiErrorCodes.EMPTY_BODY,
        message: 'No fields to update',
      });
    }
    const merged = { ...(row.details as object), ...patch.details };
    const schema = detailsSchemaForAssetType(row.assetType);
    const parsed = schema.safeParse(merged);
    if (!parsed.success) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Invalid details patch',
        details: parsed.error.issues,
      });
    }
    const withCryptedLogin = await this.maybeEncryptLogin(
      parsed.data as DetailsWithOptionalLogin,
    );
    row.details = withCryptedLogin;
    await this.repo.save(row);
    await this.audit.record({
      actorUserId: userId,
      action: 'request.patch',
      targetType: 'TestingRequest',
      targetId: id,
    });
    return this.getForUser(userId, id);
  }

  // ---------------- Upload URL ----------------

  async getMobileUploadUrl(
    userId: string,
    requestId: string,
    input: { filename: string; contentType: string; fileSize: number },
  ): Promise<SignedUploadUrlResponse> {
    const row = await this.repo.findOne({ where: { id: requestId } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    if (row.assetType !== AssetType.MOBILE_APP) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Not a mobile request',
      });
    }
    if (row.status !== RequestStatus.SUBMITTED) {
      throw new ConflictException({
        error: ApiErrorCodes.REQUEST_LOCKED,
        message: 'Request locked',
      });
    }
    const safeName = input.filename.replace(/[^\w.-]+/g, '_').slice(0, 200);
    const ext = safeName.includes('.') ? safeName.split('.').pop() : 'bin';
    const key = `mobile-uploads/${userId}/${requestId}/${randomUUID()}.${ext}`;
    const signed = await this.storage.getUploadUrl({
      key,
      contentType: input.contentType,
      contentLength: input.fileSize,
      ttlSec: 300,
    });
    return {
      uploadUrl: signed.url,
      r2Key: key,
      expiresAt: signed.expiresAt.toISOString(),
      headers: signed.headers,
    };
  }

  // ---------------- Admin views ----------------

  async listForAdmin(q: {
    status?: RequestStatus;
    assetType?: AssetType;
    testingType?: string;
    userId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
    const qb = this.repo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.user', 'u')
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (q.status) qb.andWhere('r.status = :s', { s: q.status });
    if (q.assetType) qb.andWhere('r."assetType" = :at', { at: q.assetType });
    if (q.testingType) qb.andWhere('r."testingType" = :tt', { tt: q.testingType });
    if (q.userId) qb.andWhere('r."userId" = :uid', { uid: q.userId });
    if (q.search) {
      qb.andWhere('(u.email ILIKE :q OR r.id::text = :qexact)', {
        q: `%${q.search}%`,
        qexact: q.search,
      });
    }
    const [entities, total] = await qb.getManyAndCount();
    const ids = entities.map((r) => r.id);
    const reportCounts = ids.length
      ? await this.reportRepo
          .createQueryBuilder('rep')
          .select('rep."requestId"', 'requestId')
          .addSelect('COUNT(*)', 'cnt')
          .where('rep."requestId" IN (:...ids)', { ids })
          .groupBy('rep."requestId"')
          .getRawMany<{ requestId: string; cnt: string }>()
      : [];
    const countMap = new Map(reportCounts.map((r) => [r.requestId, Number(r.cnt)]));
    const items = entities.map((r) => ({
      id: r.id,
      user: r.user
        ? {
            id: r.user.id,
            email: r.user.email,
            fullName: r.user.fullName,
            companyName: r.user.companyName,
          }
        : { id: '', email: '', fullName: '', companyName: null },
      assetType: r.assetType,
      testingType: r.testingType,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      hasReport: (countMap.get(r.id) ?? 0) > 0,
    }));
    return { items, page, pageSize, total };
  }

  async getForAdmin(id: string, revealCreds: boolean): Promise<AdminRequestDetail> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    const user = await this.repo.manager.findOne(User, { where: { id: row.userId } });
    const reports = await this.reportRepo.find({
      where: { requestId: id },
      order: { uploadedAt: 'DESC' },
    });
    const details = revealCreds
      ? await this.decryptDetails(row.details as Record<string, unknown>)
      : await this.redactDetails(row.details as Record<string, unknown>);
    return {
      id: row.id,
      user: user
        ? {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            companyName: user.companyName,
          }
        : { id: '', email: '', fullName: '', companyName: null },
      assetType: row.assetType,
      testingType: row.testingType,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      hasReport: reports.length > 0,
      details: details as AdminRequestDetail['details'],
      reports: reports.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        fileSize: String(r.fileSize),
        uploadedAt: r.uploadedAt.toISOString(),
        downloadCount: r.downloadCount,
        lastDownloadedAt: r.lastDownloadedAt?.toISOString() ?? null,
      })),
    };
  }

  async updateStatus(id: string, newStatus: RequestStatus): Promise<TestingRequest> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    // state-machine check happens in the admin controller layer
    row.status = newStatus;
    return this.repo.save(row);
  }

  async findById(id: string): Promise<TestingRequest | null> {
    return this.repo.findOne({ where: { id } });
  }

  // ---------------- Credential helpers ----------------

  private async maybeEncryptLogin(
    details: DetailsWithOptionalLogin,
  ): Promise<Record<string, unknown>> {
    if (!details || typeof details !== 'object') return details as Record<string, unknown>;
    if (!details.login) return details as Record<string, unknown>;
    const encryptedBlob = await this.crypto.encrypt(JSON.stringify(details.login));
    return { ...details, login: { __enc: encryptedBlob } } as Record<string, unknown>;
  }

  private async redactDetails(details: Record<string, unknown>): Promise<Record<string, unknown>> {
    const d = { ...details };
    if (d.login && typeof d.login === 'object') {
      const login = d.login as Record<string, unknown>;
      if ('__enc' in login) {
        d.login = { username: '****', password: '****' };
      } else {
        d.login = { ...login, password: '****' };
      }
    }
    return d;
  }

  private async decryptDetails(
    details: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const d = { ...details };
    if (d.login && typeof d.login === 'object' && '__enc' in (d.login as object)) {
      try {
        const plain = await this.crypto.decrypt(
          (d.login as { __enc: string }).__enc,
        );
        d.login = JSON.parse(plain);
      } catch (e) {
        this.logger.warn(`Failed to decrypt login creds: ${(e as Error).message}`);
        d.login = { username: '****', password: '****' };
      }
    }
    return d;
  }
}
