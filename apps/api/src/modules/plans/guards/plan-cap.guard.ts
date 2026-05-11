import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { AssetType, TestingType } from '@cs-platform/shared';

import { AppConfigService } from '../../../config/config.service';
import type { CurrentUserData } from '../../../common/decorators/current-user.decorator';
import { TestingRequest } from '../../requests/entities/testing-request.entity';
import { UsageCounter } from '../entities/usage-counter.entity';
import { PlanCapsService } from '../plan-caps.service';
import { PlanCapExceededException } from '../plan-cap-exceeded.exception';
import { startOfUtcYear } from '../plans.constants';

/**
 * Enforces plan caps on `POST /requests` — defense-in-depth pre-check.
 *
 * Wired AFTER `JwtAuthGuard` + `EmailVerifiedGuard` so `req.user` and
 * `req.body` (CreateRequestDto) are populated.
 *
 * What this guard checks:
 *   1. assetType allowed by plan
 *   2. testingType allowed by plan
 *   3. mobile-upload-disabled (mobileUploadMaxMb === 0)
 *   4. registered-assets cap (per §11 decision #1: COUNT(DISTINCT target_url))
 *   5. manual-pentest YTD pre-check + manual_pentest disabled
 *   6. red-team disabled
 *
 * What this guard NO LONGER checks (moved to `RequestsService.create` via
 * `PlanCapsService.atomicIncrementAndCheck`, the authoritative source):
 *   - submissions-per-month  (TOCTOU-prone; now atomic UPSERT in tx)
 *   - per-type sub-caps      (same — needs the atomic counter)
 *
 * Kill-switch: short-circuits to `true` when `PLAN_CAPS_ENFORCED !== 'true'`
 * (default). The same env flag is mirrored in `atomicIncrementAndCheck` so
 * the kill-switch is honored end-to-end. Doc 03 §8 step 3.
 */
@Injectable()
export class PlanCapGuard implements CanActivate {
  private readonly logger = new Logger(PlanCapGuard.name);

  constructor(
    private readonly capsService: PlanCapsService,
    @InjectRepository(UsageCounter)
    private readonly counters: Repository<UsageCounter>,
    @InjectRepository(TestingRequest)
    private readonly requests: Repository<TestingRequest>,
    private readonly cfg: AppConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.cfg.get('PLAN_CAPS_ENFORCED') !== 'true') return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: CurrentUserData }>();
    const user = req.user;
    if (!user) return true; // upstream guard should have rejected; defensive

    const dto = (req.body ?? {}) as {
      assetType?: AssetType;
      testingType?: TestingType;
      details?: Record<string, unknown>;
    };
    if (!dto.assetType || !dto.testingType) {
      // Validation pipeline will reject the bad body downstream.
      return true;
    }

    const { planId, caps } = await this.capsService.getCaps(user.id);

    // 1. Allowed asset type
    if (!caps.allowedAssetTypes.includes(dto.assetType)) {
      throw new PlanCapExceededException({
        cap: 'ASSET_TYPE_NOT_ALLOWED',
        current: dto.assetType,
        max: caps.allowedAssetTypes.join(','),
        currentPlanId: planId,
      });
    }

    // 2. Allowed testing type
    if (!caps.allowedTestingTypes.includes(dto.testingType)) {
      throw new PlanCapExceededException({
        cap: 'TESTING_TYPE_NOT_ALLOWED',
        current: dto.testingType,
        max: caps.allowedTestingTypes.join(','),
        currentPlanId: planId,
      });
    }

    // 3. Mobile uploads disabled
    if (dto.assetType === AssetType.MOBILE_APP && caps.mobileUploadMaxMb === 0) {
      throw new PlanCapExceededException({
        cap: 'MOBILE_UPLOAD_DISABLED',
        current: 0,
        max: 0,
        currentPlanId: planId,
      });
    }

    // 4. Registered assets cap (derived per §11 decision #1).
    //    Stable asset-key = first non-null of details.url / details.domain /
    //    details.packageName. Older rows missing all three are excluded.
    if (caps.registeredAssetsMax !== -1) {
      const row = await this.requests
        .createQueryBuilder('r')
        .select(
          `COUNT(DISTINCT COALESCE(r."details"->>'url', r."details"->>'domain', r."details"->>'packageName'))`,
          'cnt',
        )
        .where('r."userId" = :uid', { uid: user.id })
        .andWhere(
          `COALESCE(r."details"->>'url', r."details"->>'domain', r."details"->>'packageName') IS NOT NULL`,
        )
        .getRawOne<{ cnt: string }>();
      const usedAssets = Number(row?.cnt ?? 0);

      // Derive the asset key for the *new* request to know if it'd add a new
      // distinct asset or reuse an existing one.
      const newKey = pickAssetKey(dto.details);
      let willAdd = true;
      if (newKey) {
        const existing = await this.requests
          .createQueryBuilder('r')
          .select('1')
          .where('r."userId" = :uid', { uid: user.id })
          .andWhere(
            `COALESCE(r."details"->>'url', r."details"->>'domain', r."details"->>'packageName') = :k`,
            { k: newKey },
          )
          .limit(1)
          .getRawOne();
        if (existing) willAdd = false;
      }
      const projected = willAdd ? usedAssets + 1 : usedAssets;
      if (projected > caps.registeredAssetsMax) {
        throw new PlanCapExceededException({
          cap: 'REGISTERED_ASSETS_MAX',
          current: projected,
          max: caps.registeredAssetsMax,
          currentPlanId: planId,
        });
      }
    }

    // 5. submissions-per-month + per-type sub-cap are NOT checked here.
    //    They moved to `RequestsService.create` →
    //    `PlanCapsService.atomicIncrementAndCheck` to close the TOCTOU
    //    window (see design doc §11 decision #2).

    // 6. Manual pentest YTD
    if (dto.testingType === TestingType.MANUAL_PENTEST) {
      if (caps.manualPentestsPerYear === 0) {
        throw new PlanCapExceededException({
          cap: 'MANUAL_PENTEST_DISABLED',
          current: 0,
          max: 0,
          currentPlanId: planId,
        });
      }
      if (caps.manualPentestsPerYear !== -1) {
        const yearStart = startOfUtcYear(new Date());
        const usedYtd = await this.requests
          .createQueryBuilder('r')
          .where('r."userId" = :uid', { uid: user.id })
          .andWhere(`r."testingType" = :tt`, { tt: TestingType.MANUAL_PENTEST })
          .andWhere('r."createdAt" >= :ys', { ys: yearStart })
          .getCount();
        if (usedYtd >= caps.manualPentestsPerYear) {
          throw new PlanCapExceededException({
            cap: 'MANUAL_PENTESTS_PER_YEAR',
            current: usedYtd,
            max: caps.manualPentestsPerYear,
            currentPlanId: planId,
          });
        }
      }
    }

    // 7. Red team
    if (dto.testingType === TestingType.RED_TEAM && !caps.redTeamEnabled) {
      throw new PlanCapExceededException({
        cap: 'RED_TEAM_DISABLED',
        current: 0,
        max: 0,
        currentPlanId: planId,
      });
    }

    return true;
  }
}

function pickAssetKey(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  if (typeof d.url === 'string' && d.url.length) return d.url;
  if (typeof d.domain === 'string' && d.domain.length) return d.domain;
  if (typeof d.packageName === 'string' && d.packageName.length) return d.packageName;
  return null;
}
