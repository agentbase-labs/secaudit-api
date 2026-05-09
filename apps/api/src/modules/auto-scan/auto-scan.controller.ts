import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressReq } from 'express';
import { ApiErrorCodes, AssetType, UserRole } from '@cs-platform/shared';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequestsService } from '../requests/requests.service';
import { AutoScanService } from './auto-scan.service';

/** Admin-only endpoints under /admin. */
@UseGuards(JwtAuthGuard, EmailVerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminAutoScanController {
  constructor(
    private readonly autoScan: AutoScanService,
    private readonly requests: RequestsService,
  ) {}

  @Get('requests/:id/auto-scan')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.autoScan.getForAdmin(id);
  }

  @Post('requests/:id/auto-scan')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit('auto_scan.rescan')
  async rescan(@Param('id', ParseUUIDPipe) id: string) {
    const req = await this.requests.findById(id);
    if (!req) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'Not found' });
    }
    if (req.assetType !== AssetType.WEBSITE) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Auto-scan is only supported for website requests',
      });
    }
    const url = (req.details as { url?: string } | null)?.url;
    if (!url) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Request has no URL to scan',
      });
    }
    return this.autoScan.runScan(id, url);
  }

  @Patch('auto-scan/findings/:id/promote')
  @Audit('auto_scan.finding.promote')
  async promote(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.autoScan.promoteFinding(me.id, id, req.ip ?? null);
  }

  @Patch('auto-scan/findings/:id/dismiss')
  @Audit('auto_scan.finding.dismiss')
  async dismiss(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    const reason = (body?.reason ?? '').toString().trim();
    if (!reason) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Reason is required to dismiss a finding',
      });
    }
    return this.autoScan.dismissFinding(me.id, id, reason, req.ip ?? null);
  }
}

/** Client-facing read-only summary. Heavily redacted. */
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
@Controller('requests')
export class ClientAutoScanController {
  constructor(private readonly autoScan: AutoScanService) {}

  @Get(':id/auto-scan-summary')
  async summary(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.autoScan.getSummaryForClient(id, me.id);
  }
}
