import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { STORAGE_SERVICE } from '../storage/storage.service';
import type { StorageService } from '../storage/storage.service';

/**
 * Scheduled jobs:
 *  - audit-log cleanup (AUDIT_LOG_RETENTION_DAYS, default 365)
 *  - R2 orphan sweeper (TODO phase1): lists keys older than 24h with no DB ref and deletes them
 *  - mobile-upload retention enforcer (TODO phase1)
 */
@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly cfg: AppConfigService,
    @Inject(STORAGE_SERVICE) private readonly _storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupAuditLogs(): Promise<void> {
    const days = this.cfg.get('AUDIT_LOG_RETENTION_DAYS');
    if (!days || days <= 0) return;
    try {
      const deleted = await this.audit.cleanupOlderThan(days);
      if (deleted > 0) this.logger.log(`audit cleanup: deleted ${deleted} rows older than ${days}d`);
    } catch (e) {
      this.logger.warn(`audit cleanup failed: ${(e as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async reconcileR2Orphans(): Promise<void> {
    // TODO(phase1): list R2 objects older than 24h with no TestingRequest.details.mobileFileKey
    // or Report.r2Key reference; delete via storage.deleteObject(key).
    this.logger.debug('R2 orphan reconcile: stub (no-op)');
  }

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async enforceMobileUploadRetention(): Promise<void> {
    const days = this.cfg.get('MOBILE_UPLOAD_RETENTION_DAYS');
    // TODO(phase1): list `mobile-uploads/*` older than `days`, delete via storage.deleteObject(key).
    this.logger.debug(`mobile upload retention: stub (days=${days})`);
  }
}
