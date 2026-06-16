import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressReq } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '@cs-platform/shared';
import type {
  AdminListVerifiedTargetsResult,
  AdminRequestScanResult,
} from '@cs-platform/shared';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ActiveScanService } from './active-scan.service';
import { StreamTokenService } from './stream-token.service';
import { ActiveScanJobEntity } from './entities/active-scan-job.entity';
import {
  AdminListTargetsQueryDto,
  AdminRequestScanDto,
} from './dto/active-scan.dto';

function clientIp(req: ExpressReq): string | null {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket.remoteAddress ||
    null
  );
}

/**
 * Admin review surface (ACTIVE_SCAN_DESIGN.md §9.4). Modeled on
 * AdminAutoScanController. Admins can list any user's scans, drill into a
 * job's full findings + audit trail, and kill any running job (§7.4).
 */
@UseGuards(JwtAuthGuard, EmailVerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/active-scan')
export class AdminActiveScanController {
  constructor(
    private readonly service: ActiveScanService,
    private readonly streamTokens: StreamTokenService,
    @InjectRepository(ActiveScanJobEntity)
    private readonly jobs: Repository<ActiveScanJobEntity>,
  ) {}

  // ── Verified targets (cross-user) ────────────────────────────────────

  /**
   * List verified targets across ALL users (joined with the owning user's
   * email + name). Supports optional `?status=` / `?userId=` filters and
   * `page`/`pageSize`. Ordered by createdAt DESC.
   */
  @Get('targets')
  async listTargets(
    @Query() query: AdminListTargetsQueryDto,
  ): Promise<AdminListVerifiedTargetsResult> {
    return this.service.adminListTargets({
      status: query.status,
      userId: query.userId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // ── Trigger a deep scan on a user-verified target ─────────────────────

  /**
   * Trigger a deep (active) scan on a user's already-verified target. The job
   * is created for the TARGET OWNER, bypasses plan caps (admin authority), and
   * preserves verification + the user's proven ownership/authorization. Returns
   * a stream token so the admin UI can open the SSE live view immediately.
   */
  @Post('scans')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit('active_scan.admin_triggered')
  async triggerScan(
    @CurrentUser() me: CurrentUserData,
    @Body() dto: AdminRequestScanDto,
    @Req() req: ExpressReq,
  ): Promise<AdminRequestScanResult> {
    const ip = clientIp(req);
    // The service records planAtRequest as the TARGET OWNER's current plan
    // (legal/billing evidence belongs to the user the job runs for).
    const { jobId, status, targetUserId } = await this.service.adminRequestScan(
      me.id,
      dto.targetId,
      ip,
    );
    const streamToken = this.streamTokens.sign(jobId, targetUserId);
    return { jobId, status, streamToken, targetUserId };
  }

  /** List scans, optionally filtered by userId. */
  @Get('scans')
  async list(
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const take = Math.min(100, Math.max(1, Number(pageSize) || 50));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const [items, total] = await this.jobs.findAndCount({
      where: userId ? { userId } : {},
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
    return { items, total, page: Number(page) || 1, pageSize: take };
  }

  /** Full job + findings (admin view — no redaction). */
  @Get('scans/:id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) return { job: null, findings: [], byHost: [] };
    return this.service.getFindings(job.userId, id);
  }

  /** Admin kill-switch — cancel any running job. */
  @Post('scans/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Audit('active_scan.admin_killed')
  async cancel(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ExpressReq,
  ) {
    const ip = req.ip ?? null;
    return this.service.cancelJob(me.id, id, ip, true);
  }
}
