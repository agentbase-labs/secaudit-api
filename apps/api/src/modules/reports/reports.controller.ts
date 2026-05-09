import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressReq } from 'express';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DownloadReportDto } from './dto/download.dto';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * Owner-only metadata + decrypted PDF password.
   *
   * Per the locked policy the password is always visible to the report
   * owner in the portal UI. Every fetch where the password is included is
   * audit-logged as `report.password.viewed`.
   */
  @Get(':id')
  async meta(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reports.getReportForOwner(me.id, id, req.ip ?? null);
  }

  /**
   * Owner-only signed download URL for the encrypted PDF.
   * No password in the request body \u2014 ownership is enforced via JWT.
   */
  @Get(':id/download')
  @Audit('report.download')
  async downloadGet(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reports.getDownloadUrlForOwner(me.id, id, req.ip ?? null);
  }

  /**
   * Legacy password-gated download (kept for backwards-compat).
   */
  @Post(':id/download')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @Audit('report.download')
  async download(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DownloadReportDto,
  ) {
    return this.reports.download(me.id, id, dto.password, req.ip ?? null);
  }
}
