import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { Request } from 'express';
import { ApiErrorCodes } from '@cs-platform/shared';
import { ACTIVE_SCAN_ACTIVE_STATUSES } from '@cs-platform/shared';

import { AppConfigService } from '../../../config/config.service';
import type { CurrentUserData } from '../../../common/decorators/current-user.decorator';
import { PlanCapsService } from '../../plans/plan-caps.service';
import { PlanCapExceededException } from '../../plans/plan-cap-exceeded.exception';
import { ActiveScanJobEntity } from '../entities/active-scan-job.entity';

/**
 * Gate on `POST /active-scan/scans` (ACTIVE_SCAN_DESIGN.md §7.3). Wired AFTER
 * JwtAuthGuard + EmailVerifiedGuard so `req.user` is populated.
 *
 * Checks (defense-in-depth pre-checks; the monthly quota is also enforced
 * atomically inside the request transaction via
 * `PlanCapsService.atomicIncrementActiveScanAndCheck`):
 *   1. global feature flag (ACTIVE_SCAN_ENABLED) — admin kill-switch.
 *   2. entitlement — `activeScansPerMonth !== 0` (0/undefined ⇒ disabled,
 *      rejected with the structured 402 + suggestUpgradeTo).
 *   3. per-user concurrency — count of non-terminal jobs < activeScanConcurrency.
 *
 * The atomic monthly-quota counter (§7.3) is intentionally NOT checked here
 * (TOCTOU-prone) — it lives in the service tx, mirroring how submissions
 * moved out of PlanCapGuard.
 */
@Injectable()
export class ActiveScanPlanGuard implements CanActivate {
  constructor(
    private readonly capsService: PlanCapsService,
    private readonly cfg: AppConfigService,
    @InjectRepository(ActiveScanJobEntity)
    private readonly jobs: Repository<ActiveScanJobEntity>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // 1. Global kill-switch.
    if (!this.cfg.activeScanEnabled) {
      throw new ForbiddenException({
        error: ApiErrorCodes.FORBIDDEN,
        message: 'Active scanning is currently disabled',
      });
    }

    const req = ctx.switchToHttp().getRequest<Request & { user?: CurrentUserData }>();
    const user = req.user;
    if (!user) return true; // upstream guard rejects; defensive

    const { planId, caps } = await this.capsService.getCaps(user.id);
    const perMonth = caps.activeScansPerMonth ?? 0;
    const concurrency = caps.activeScanConcurrency ?? 0;

    // 2. Entitlement.
    if (perMonth === 0) {
      throw new PlanCapExceededException({
        cap: 'ACTIVE_SCANS_PER_MONTH',
        current: 0,
        max: 0,
        currentPlanId: planId,
      });
    }

    // 3. Concurrency.
    if (concurrency !== -1) {
      const running = await this.jobs.count({
        where: {
          userId: user.id,
          status: In(ACTIVE_SCAN_ACTIVE_STATUSES),
        },
      });
      if (running >= concurrency) {
        throw new PlanCapExceededException({
          cap: 'ACTIVE_SCAN_CONCURRENCY',
          current: running,
          max: concurrency,
          currentPlanId: planId,
        });
      }
    }

    return true;
  }
}
