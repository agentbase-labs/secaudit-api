import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  ApiErrorCodes,
  RequestStatus,
  type ReportDownloadResponse,
  type ReportSummary,
} from '@cs-platform/shared';

import { generateReportPassword } from '../crypto/report-password';
import { ReportPasswordCipher } from '../crypto/report-password.cipher';
import { AppConfigService } from '../../config/config.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import type { MailService } from '../mail/mail.service';
import { STORAGE_SERVICE } from '../storage/storage.service';
import type { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { TestingRequest } from '../requests/entities/testing-request.entity';
import { User } from '../users/entities/user.entity';
import { Report } from './entities/report.entity';
import { QpdfService } from '../pdf/qpdf.service';

const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap on multipart admin uploads

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(Report) private readonly repo: Repository<Report>,
    @InjectRepository(TestingRequest) private readonly reqRepo: Repository<TestingRequest>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly cfg: AppConfigService,
    private readonly qpdf: QpdfService,
    private readonly cipher: ReportPasswordCipher,
  ) {}

  // =====================================================================
  //  Client-facing
  // =====================================================================

  /**
   * Owner-only metadata + decrypted password. Audit-logs every read where
   * the password is included in the response.
   */
  async getReportForOwner(
    userId: string,
    reportId: string,
    ip: string | null,
  ): Promise<ReportSummary & { password: string | null; passwordCreatedAt: string | null }> {
    const { report } = await this.loadOwned(userId, reportId);

    let password: string | null = null;
    if (report.passwordCiphertext && report.passwordIv && report.passwordTag) {
      try {
        password = this.cipher.decrypt({
          ciphertext: report.passwordCiphertext,
          iv: report.passwordIv,
          tag: report.passwordTag,
        });
      } catch (e) {
        this.logger.warn(
          `report-password decrypt failed for ${report.id}: ${(e as Error).message}`,
        );
      }
    }

    if (password) {
      await this.audit.record({
        actorUserId: userId,
        action: 'report.password.viewed',
        targetType: 'Report',
        targetId: report.id,
        ip,
      });
    }

    return {
      id: report.id,
      requestId: report.requestId,
      fileSize: String(report.fileSize),
      uploadedAt: report.uploadedAt.toISOString(),
      downloadCount: report.downloadCount,
      lastDownloadedAt: report.lastDownloadedAt?.toISOString() ?? null,
      password,
      passwordCreatedAt: report.passwordCreatedAt?.toISOString() ?? null,
    };
  }

  /**
   * Owner-only signed download URL for the encrypted PDF.
   * Returns the same shape as the legacy POST /reports/:id/download.
   */
  async getDownloadUrlForOwner(
    userId: string,
    reportId: string,
    ip: string | null,
  ): Promise<ReportDownloadResponse> {
    const { report } = await this.loadOwned(userId, reportId);
    const signed = await this.storage.getDownloadUrl({
      key: report.encryptedPdfR2Key,
      ttlSec: 60,
      downloadFilename: `report-${report.requestId}.pdf`,
    });
    void this.repo
      .update(report.id, {
        downloadCount: report.downloadCount + 1,
        lastDownloadedAt: new Date(),
      })
      .catch(() => undefined);
    await this.audit.record({
      actorUserId: userId,
      action: 'report.download',
      targetType: 'Report',
      targetId: report.id,
      ip,
    });
    return {
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      contentType: 'application/pdf',
    };
  }

  /**
   * Legacy password-gated download (POST /reports/:id/download).
   * Kept for backwards-compat; new clients should use the GET endpoints
   * which already authenticate the owner via JWT.
   */
  async download(
    userId: string,
    reportId: string,
    password: string,
    ip: string | null,
  ): Promise<ReportDownloadResponse> {
    const { report } = await this.loadOwned(userId, reportId);

    let ok = false;
    if (report.passwordCiphertext && report.passwordIv && report.passwordTag) {
      try {
        const stored = this.cipher.decrypt({
          ciphertext: report.passwordCiphertext,
          iv: report.passwordIv,
          tag: report.passwordTag,
        });
        ok = constantTimeEqualStrings(stored, password);
      } catch {
        ok = false;
      }
    } else if (report.passwordHash) {
      ok = await bcrypt.compare(password, report.passwordHash);
    }

    if (!ok) {
      await this.audit.record({
        actorUserId: userId,
        action: 'report.download_failed',
        targetType: 'Report',
        targetId: reportId,
        ip,
      });
      throw new UnauthorizedException({
        error: ApiErrorCodes.PASSWORD_INVALID,
        message: 'Invalid password',
      });
    }

    return this.getDownloadUrlForOwner(userId, reportId, ip);
  }

  async getMetadataForUser(userId: string, reportId: string): Promise<ReportSummary> {
    const { report } = await this.loadOwned(userId, reportId);
    return {
      id: report.id,
      requestId: report.requestId,
      fileSize: String(report.fileSize),
      uploadedAt: report.uploadedAt.toISOString(),
      downloadCount: report.downloadCount,
      lastDownloadedAt: report.lastDownloadedAt?.toISOString() ?? null,
    };
  }

  // =====================================================================
  //  Admin
  // =====================================================================

  /**
   * Admin uploads a final PDF for a request.
   *
   *   1. Validate magic bytes.
   *   2. Generate a 16-char password (base62).
   *   3. Encrypt PDF buffer via qpdf (AES-256).
   *   4. Upload BOTH the original (admin-only) and the encrypted variant to R2.
   *   5. Persist Report with AES-GCM-encrypted password (ct/iv/tag).
   *   6. Move parent request to `completed`.
   *   7. Send Email A (link) + Email B (password), both fire-and-forget.
   *
   * Returns the report id + the plaintext password (for the admin UI's
   * one-time toast preview — never persisted in plaintext).
   */
  async uploadReportFromBuffer(
    adminId: string,
    requestId: string,
    file: { buffer: Buffer; size: number; originalName: string; mimetype: string },
    ip: string | null,
  ): Promise<{
    id: string;
    reportId: string;
    password: string;
    encryptedPdfR2Key: string;
  }> {
    if (file.size <= 0 || file.size > PDF_MAX_BYTES) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: `PDF must be 1..${PDF_MAX_BYTES} bytes`,
      });
    }
    if (!QpdfService.isPdfBuffer(file.buffer)) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'File is not a valid PDF (missing %PDF- magic)',
      });
    }

    const request = await this.reqRepo.findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    const client = await this.userRepo.findOne({ where: { id: request.userId } });
    if (!client) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Client not found' });
    }

    // 1. Generate password
    const password = generateReportPassword();

    // 2. Encrypt via qpdf
    const encryptedBuffer = await this.qpdf.encryptPdf(file.buffer, password);

    // 3. Upload both variants
    const reportId2 = randomUUID();
    const originalKey = `reports/${request.userId}/${request.id}/${reportId2}.original.pdf`;
    const encryptedKey = `reports/${request.userId}/${request.id}/${reportId2}.pdf`;
    await this.storage.putObject({
      key: originalKey,
      body: file.buffer,
      contentType: 'application/pdf',
    });
    await this.storage.putObject({
      key: encryptedKey,
      body: encryptedBuffer,
      contentType: 'application/pdf',
    });

    // 4. Encrypt password at rest
    const cipherParts = this.cipher.encrypt(password);
    const now = new Date();

    // 5. Persist
    const report = await this.repo.save(
      this.repo.create({
        id: reportId2,
        requestId: request.id,
        encryptedPdfR2Key: encryptedKey,
        originalPdfR2Key: originalKey,
        fileSize: String(encryptedBuffer.length),
        passwordCiphertext: cipherParts.ciphertext,
        passwordIv: cipherParts.iv,
        passwordTag: cipherParts.tag,
        passwordCreatedAt: now,
        passwordHash: null,
        pdfSelfEncrypted: true,
        uploadedBy: adminId,
        downloadCount: 0,
      }),
    );

    // 6. Move request to COMPLETED (audit-logged)
    const previousStatus = request.status;
    request.status = RequestStatus.COMPLETED;
    await this.reqRepo.save(request);

    await this.audit.record({
      actorUserId: adminId,
      action: 'report.created',
      targetType: 'Report',
      targetId: report.id,
      ip,
      meta: {
        requestId: request.id,
        encryptedPdfR2Key: encryptedKey,
        fileSize: encryptedBuffer.length,
        originalFilename: file.originalName,
      },
    });
    await this.audit.record({
      actorUserId: adminId,
      action: 'report.password.generated',
      targetType: 'Report',
      targetId: report.id,
      ip,
      meta: { reportId: report.id },
    });
    await this.audit.record({
      actorUserId: adminId,
      action: 'request.status_update',
      targetType: 'TestingRequest',
      targetId: request.id,
      ip,
      meta: { from: previousStatus, to: RequestStatus.COMPLETED, via: 'report.upload' },
    });

    // 7. Two emails — sequential, fire-and-forget
    const dashboardUrl = `${this.cfg.get('APP_URL')}/dashboard/reports/${report.id}`;
    const fireAndForget = async () => {
      try {
        await this.mail.sendTemplate({
          to: client.email,
          template: 'report-ready',
          data: {
            fullName: client.fullName,
            requestId: request.id,
            reportId: report.id,
            downloadUrl: dashboardUrl,
          },
        });
        await this.audit.record({
          actorUserId: adminId,
          action: 'report.email.ready_sent',
          targetType: 'Report',
          targetId: report.id,
          meta: { to: client.email },
        });
      } catch (e) {
        this.logger.warn(`report-ready email failed: ${(e as Error).message}`);
      }
      try {
        await this.mail.sendTemplate({
          to: client.email,
          template: 'pdf-password',
          data: {
            fullName: client.fullName,
            requestId: request.id,
            reportId: report.id,
            pdfPassword: password,
          },
        });
        await this.audit.record({
          actorUserId: adminId,
          action: 'report.email.password_sent',
          targetType: 'Report',
          targetId: report.id,
          meta: { to: client.email },
        });
      } catch (e) {
        this.logger.warn(`pdf-password email failed: ${(e as Error).message}`);
      }
    };
    void fireAndForget();

    return {
      id: report.id,
      reportId: report.id,
      password,
      encryptedPdfR2Key: encryptedKey,
    };
  }

  /**
   * Re-encrypt the original PDF with a fresh password, overwrite the encrypted
   * R2 object, rotate the AES-GCM password ciphertext, and re-send Email B.
   *
   * Requires `originalPdfR2Key` to be present (legacy reports without it fall
   * back to a plaintext-password rotation only — no re-encrypt possible).
   */
  async regeneratePassword(
    adminId: string,
    reportId: string,
    reason: string,
    ip: string | null,
  ): Promise<{ reportId: string; password: string; reEncrypted: boolean }> {
    const report = await this.repo.findOne({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    const request = await this.reqRepo.findOne({ where: { id: report.requestId } });
    const client = request
      ? await this.userRepo.findOne({ where: { id: request.userId } })
      : null;
    if (!client || !request) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Client not found' });
    }

    const newPassword = generateReportPassword();
    let reEncrypted = false;

    if (report.originalPdfR2Key) {
      // Pull the original, re-encrypt, overwrite the encrypted variant.
      const original = await this.storage.getObject(report.originalPdfR2Key);
      const reEncryptedBuf = await this.qpdf.encryptPdf(original, newPassword);
      await this.storage.putObject({
        key: report.encryptedPdfR2Key,
        body: reEncryptedBuf,
        contentType: 'application/pdf',
      });
      report.fileSize = String(reEncryptedBuf.length);
      reEncrypted = true;
    } else {
      this.logger.warn(
        `regeneratePassword: report ${report.id} has no originalPdfR2Key; rotating stored password only (PDF file NOT re-encrypted)`,
      );
    }

    const cipherParts = this.cipher.encrypt(newPassword);
    report.passwordCiphertext = cipherParts.ciphertext;
    report.passwordIv = cipherParts.iv;
    report.passwordTag = cipherParts.tag;
    report.passwordCreatedAt = new Date();
    report.passwordHash = null;
    await this.repo.save(report);

    await this.audit.record({
      actorUserId: adminId,
      action: 'report.password.regenerated',
      targetType: 'Report',
      targetId: report.id,
      ip,
      meta: { reason, reEncrypted },
    });

    void this.mail
      .sendTemplate({
        to: client.email,
        template: 'pdf-password',
        data: {
          fullName: client.fullName,
          requestId: request.id,
          reportId: report.id,
          pdfPassword: newPassword,
          reason: reason || 'Password regenerated by admin',
        },
      })
      .then(() =>
        this.audit.record({
          actorUserId: adminId,
          action: 'report.email.password_sent',
          targetType: 'Report',
          targetId: report.id,
          meta: { to: client.email, regenerated: true },
        }),
      )
      .catch((e) => this.logger.warn(`pdf-password email failed: ${(e as Error).message}`));

    return { reportId: report.id, password: newPassword, reEncrypted };
  }

  // =====================================================================
  //  Legacy admin signed-URL flow (kept until UI fully migrates)
  // =====================================================================

  async createUploadUrl(
    requestId: string,
    input: { filename: string; contentType: string; fileSize: number },
  ): Promise<{
    uploadUrl: string;
    r2Key: string;
    expiresAt: string;
    headers: Record<string, string>;
  }> {
    const request = await this.reqRepo.findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    const key = `reports/${request.userId}/${request.id}/${randomUUID()}.pdf`;
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

  /**
   * Legacy: confirms a presigned upload (admin pre-encrypted the PDF themselves).
   * The new flow goes through `uploadReportFromBuffer` instead. Kept for
   * backwards compat with existing admin tooling.
   */
  async createReport(
    uploaderId: string,
    requestId: string,
    input: { r2Key: string; fileSize: number; pdfSelfEncrypted?: boolean },
    ip: string | null,
  ): Promise<{ id: string; reportId: string }> {
    const request = await this.reqRepo.findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    const client = await this.userRepo.findOne({ where: { id: request.userId } });
    if (!client) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Client not found' });
    }

    const password = generateReportPassword();
    const cipherParts = this.cipher.encrypt(password);

    const report = await this.repo.save(
      this.repo.create({
        requestId: request.id,
        encryptedPdfR2Key: input.r2Key,
        originalPdfR2Key: null,
        fileSize: String(input.fileSize),
        passwordCiphertext: cipherParts.ciphertext,
        passwordIv: cipherParts.iv,
        passwordTag: cipherParts.tag,
        passwordCreatedAt: new Date(),
        passwordHash: null,
        pdfSelfEncrypted: input.pdfSelfEncrypted === true,
        uploadedBy: uploaderId,
        downloadCount: 0,
      }),
    );
    request.status = RequestStatus.REPORT_READY;
    await this.reqRepo.save(request);

    const dashboardUrl = `${this.cfg.get('APP_URL')}/dashboard/reports/${report.id}`;
    void this.mail
      .sendTemplate({
        to: client.email,
        template: 'report-ready',
        data: {
          fullName: client.fullName,
          requestId: request.id,
          reportId: report.id,
          downloadUrl: dashboardUrl,
        },
      })
      .catch((e) => this.logger.warn(`report-ready email failed: ${(e as Error).message}`));
    void this.mail
      .sendTemplate({
        to: client.email,
        template: 'pdf-password',
        data: {
          fullName: client.fullName,
          requestId: request.id,
          reportId: report.id,
          pdfPassword: password,
        },
      })
      .catch((e) => this.logger.warn(`pdf-password email failed: ${(e as Error).message}`));

    await this.audit.record({
      actorUserId: uploaderId,
      action: 'report.upload',
      targetType: 'Report',
      targetId: report.id,
      ip,
      meta: { requestId: request.id, r2Key: input.r2Key, fileSize: input.fileSize },
    });

    return { id: report.id, reportId: report.id };
  }

  // =====================================================================
  //  Internals
  // =====================================================================

  private async loadOwned(
    userId: string,
    reportId: string,
  ): Promise<{ report: Report; request: TestingRequest }> {
    const report = await this.repo.findOne({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    const request = await this.reqRepo.findOne({ where: { id: report.requestId } });
    if (!request) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    if (request.userId !== userId) {
      throw new ForbiddenException({ error: ApiErrorCodes.NOT_OWNER, message: 'Not owner' });
    }
    return { report, request };
  }
}

function constantTimeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
