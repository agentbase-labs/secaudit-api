import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiErrorCodes, RequestStatus } from '@cs-platform/shared';

import { ReportPasswordCipher } from '../crypto/report-password.cipher';
import { MAIL_SERVICE } from '../mail/mail.service';
import type { MailService } from '../mail/mail.service';
import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { Report } from '../reports/entities/report.entity';
import { RequestsService } from '../requests/requests.service';
import { canTransition } from '../requests/state-machine';
import { UsersService } from '../users/users.service';

@Injectable()
export class AdminRequestsService {
  private readonly logger = new Logger(AdminRequestsService.name);

  constructor(
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    private readonly requests: RequestsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly cfg: AppConfigService,
    private readonly cipher: ReportPasswordCipher,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
  ) {}

  async updateStatus(
    adminId: string,
    requestId: string,
    newStatus: RequestStatus,
    note: string | undefined,
    ip: string | null,
  ) {
    const row = await this.requests.findById(requestId);
    if (!row) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    if (!canTransition(row.status, newStatus)) {
      throw new BadRequestException({
        error: ApiErrorCodes.INVALID_TRANSITION,
        message: `Cannot transition ${row.status} → ${newStatus}`,
      });
    }
    const updated = await this.requests.updateStatus(requestId, newStatus);
    await this.audit.record({
      actorUserId: adminId,
      action: 'request.status_update',
      targetType: 'TestingRequest',
      targetId: requestId,
      ip,
      meta: { from: row.status, to: newStatus, note: note ?? null },
    });

    // Notify client
    const client = await this.users.findById(row.userId);
    if (client) {
      void this.mail
        .sendTemplate({
          to: client.email,
          template: 'status-change',
          data: {
            fullName: client.fullName,
            requestId,
            newStatus,
            note,
            dashboardUrl: `${this.cfg.get('APP_URL')}/dashboard/requests/${requestId}`,
          },
        })
        .catch((e) => this.logger.warn(`status-change email failed: ${(e as Error).message}`));
    }

    return { status: updated.status, updatedAt: updated.updatedAt.toISOString() };
  }

  /**
   * Admin report detail: metadata + decrypted password + recent audit log entries.
   * Reading the password here is itself audit-logged.
   */
  async getReportDetail(adminId: string, reportId: string, ip: string | null) {
    const report = await this.reportRepo.findOne({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }

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
          `admin: report-password decrypt failed for ${report.id}: ${(e as Error).message}`,
        );
      }
    }

    if (password) {
      await this.audit.record({
        actorUserId: adminId,
        action: 'report.password.viewed',
        targetType: 'Report',
        targetId: report.id,
        ip,
        meta: { admin: true },
      });
    }

    const auditPreview = await this.audit.list({
      targetType: 'Report',
      targetId: report.id,
      page: 1,
      pageSize: 25,
    });

    return {
      id: report.id,
      requestId: report.requestId,
      encryptedPdfR2Key: report.encryptedPdfR2Key,
      hasOriginal: report.originalPdfR2Key !== null,
      fileSize: String(report.fileSize),
      uploadedAt: report.uploadedAt.toISOString(),
      uploadedBy: report.uploadedBy,
      downloadCount: report.downloadCount,
      lastDownloadedAt: report.lastDownloadedAt?.toISOString() ?? null,
      pdfSelfEncrypted: report.pdfSelfEncrypted,
      password,
      passwordCreatedAt: report.passwordCreatedAt?.toISOString() ?? null,
      auditLog: auditPreview.items.map((a) => ({
        id: a.id,
        action: a.action,
        actorUserId: a.actorUserId,
        createdAt: a.createdAt.toISOString(),
        meta: a.meta,
      })),
    };
  }
}
