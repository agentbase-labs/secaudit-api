import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';

import { AppConfigService } from '../../../config/config.service';
import type { CurrentUserData } from '../../../common/decorators/current-user.decorator';
import { Report } from '../../reports/entities/report.entity';
import { PlanCapsService } from '../plan-caps.service';
import { PlanCapExceededException } from '../plan-cap-exceeded.exception';

/**
 * Soft-block on report access older than the user's plan retention.
 *
 * Per \u00a711 decision #5 the R2 object is NOT deleted at the retention
 * horizon — an R2 lifecycle policy (separately configured) deletes after
 * `retentionDays + 90` days. This guard returns 402 from the API while
 * the object is technically still in the bucket; an upgrade flips access
 * back on instantly.
 */
@Injectable()
export class RetentionGuard implements CanActivate {
  private readonly logger = new Logger(RetentionGuard.name);

  constructor(
    private readonly capsService: PlanCapsService,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    private readonly cfg: AppConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.cfg.get('PLAN_CAPS_ENFORCED') !== 'true') return true;

    const req = ctx.switchToHttp().getRequest<
      Request & { user?: CurrentUserData; params: Record<string, string> }
    >();
    const user = req.user;
    if (!user) return true;

    const reportId = req.params?.id;
    if (!reportId) return true;

    const report = await this.reports.findOne({ where: { id: reportId } });
    if (!report) return true; // controller will 404

    const { caps, planId } = await this.capsService.getCaps(user.id);
    if (!caps.retentionDays || caps.retentionDays <= 0) return true;

    const ageDays = Math.floor(
      (Date.now() - report.uploadedAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (ageDays > caps.retentionDays) {
      throw new PlanCapExceededException({
        cap: 'RETENTION_DAYS',
        current: ageDays,
        max: caps.retentionDays,
        currentPlanId: planId,
        message: `Report retention on ${planId} is ${caps.retentionDays} days. Upgrade to keep older reports accessible.`,
      });
    }
    return true;
  }
}
