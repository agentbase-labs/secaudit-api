import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressReq } from 'express';
import { Observable } from 'rxjs';
import { ApiErrorCodes } from '@cs-platform/shared';
import type {
  RequestScanResult,
  StreamTokenResult,
} from '@cs-platform/shared';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlanCapsService } from '../plans/plan-caps.service';
import { ActiveScanService } from './active-scan.service';
import { ActiveScanPlanGuard } from './guards/active-scan-plan.guard';
import { StreamTokenGuard } from './guards/stream-token.guard';
import { StreamTokenService } from './stream-token.service';
import {
  AddTargetDto,
  ListScansQueryDto,
  RequestScanDto,
  VerifyTargetDto,
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
 * Client-facing Active / Deep Scan endpoints. All under /v1/active-scan,
 * guarded by JwtAuthGuard + EmailVerifiedGuard; the scan-request endpoint adds
 * ActiveScanPlanGuard. The SSE stream is the one exception (token-authed).
 */
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
@Controller('active-scan')
export class ActiveScanController {
  constructor(
    private readonly service: ActiveScanService,
    private readonly streamTokens: StreamTokenService,
    private readonly caps: PlanCapsService,
  ) {}

  // ── Targets ────────────────────────────────────────────────────────────

  @Post('targets')
  @Audit('active_scan.target.added')
  async addTarget(
    @CurrentUser() me: CurrentUserData,
    @Body() dto: AddTargetDto,
    @Req() req: ExpressReq,
  ) {
    return this.service.addTarget(me.id, dto.hostname, clientIp(req));
  }

  @Get('targets')
  async listTargets(@CurrentUser() me: CurrentUserData) {
    return this.service.listTargets(me.id);
  }

  @Post('targets/:id/verify')
  @Audit('active_scan.target.verify')
  async verifyTarget(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyTargetDto,
    @Req() req: ExpressReq,
  ) {
    return this.service.verifyTarget(me.id, id, dto.method, clientIp(req));
  }

  @Delete('targets/:id')
  @Audit('active_scan.target.removed')
  async removeTarget(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ExpressReq,
  ) {
    return this.service.removeTarget(me.id, id, clientIp(req));
  }

  // ── Scans ──────────────────────────────────────────────────────────────

  @Post('scans')
  @UseGuards(ActiveScanPlanGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit('active_scan.requested')
  async requestScan(
    @CurrentUser() me: CurrentUserData,
    @Body() dto: RequestScanDto,
    @Req() req: ExpressReq,
  ): Promise<RequestScanResult> {
    const { planId } = await this.caps.getCaps(me.id);
    const { jobId, status } = await this.service.requestScan(
      me.id,
      planId,
      dto.targetId,
      dto.authorizationAccepted,
      dto.authorizationVersion ?? null,
      clientIp(req),
    );
    const streamToken = this.streamTokens.sign(jobId, me.id);
    return { jobId, status, streamToken };
  }

  @Get('scans')
  async listScans(
    @CurrentUser() me: CurrentUserData,
    @Query() query: ListScansQueryDto,
  ) {
    return this.service.listScans(me.id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get('scans/:id')
  async getScan(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getJob(me.id, id);
  }

  @Get('scans/:id/findings')
  async getFindings(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getFindings(me.id, id);
  }

  /** Refresh / issue a stream token (the request response also returns one). */
  @Post('scans/:id/stream-token')
  async issueStreamToken(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamTokenResult> {
    // Ownership check: throws 404 if the job isn't the caller's.
    await this.service.getJob(me.id, id);
    return {
      streamToken: this.streamTokens.sign(id, me.id),
      expiresIn: this.streamTokens.ttlSec,
    };
  }

  @Post('scans/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Audit('active_scan.cancelled')
  async cancel(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ExpressReq,
  ) {
    return this.service.cancelJob(me.id, id, clientIp(req));
  }
}

/**
 * SSE live-progress stream. Separate controller so it can be @Public() (the
 * global JwtAuthGuard skips it) and use the StreamTokenGuard instead — because
 * EventSource cannot send an Authorization header (§5.3).
 */
@Controller('active-scan')
export class ActiveScanStreamController {
  constructor(private readonly service: ActiveScanService) {}

  @Public()
  @UseGuards(StreamTokenGuard)
  @Sse('scans/:id/stream')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ExpressReq & { streamToken?: { jobId: string; userId: string } },
  ): Promise<Observable<MessageEvent>> {
    if (!req.streamToken || req.streamToken.jobId !== id) {
      throw new UnauthorizedException({
        error: ApiErrorCodes.UNAUTHORIZED,
        message: 'Invalid stream token',
      });
    }
    return this.service.stream(id);
  }
}
