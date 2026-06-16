import {
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

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ActiveScanService } from './active-scan.service';
import { ActiveScanJobEntity } from './entities/active-scan-job.entity';

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
    @InjectRepository(ActiveScanJobEntity)
    private readonly jobs: Repository<ActiveScanJobEntity>,
  ) {}

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
