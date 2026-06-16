import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressReq } from 'express';
import type {
  ActiveScanFindingCounts,
  SkyNetSummary,
  WorkerClaimResponse,
} from '@cs-platform/shared';

import { Public } from '../../common/decorators/public.decorator';
import { ActiveScanService } from './active-scan.service';
import { WorkerSecretGuard } from './guards/worker-secret.guard';
import {
  WorkerCompleteDto,
  WorkerFindingsDto,
  WorkerProgressDto,
} from './dto/active-scan.dto';

/**
 * Internal worker↔backend endpoints (ACTIVE_SCAN_DESIGN.md §5.2). The isolated
 * SkyNet worker calls these; auth is the `X-Worker-Secret` header (constant-
 * time compared) via WorkerSecretGuard — NOT JWT.
 *
 * @Public() so the global JwtAuthGuard skips the route; WorkerSecretGuard is
 * the real gate. Mounted under /v1/internal/active-scan.
 */
@Public()
@UseGuards(WorkerSecretGuard)
@Controller('internal/active-scan')
export class InternalActiveScanController {
  constructor(private readonly service: ActiveScanService) {}

  /** Atomic claim → backend sets running, returns job payload. */
  @Post(':jobId/claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: ExpressReq,
  ): Promise<WorkerClaimResponse> {
    const workerId =
      ((req.headers['x-worker-id'] as string) ?? '').slice(0, 64) || 'worker';
    return this.service.workerClaim(jobId, workerId);
  }

  @Post(':jobId/progress')
  @HttpCode(HttpStatus.OK)
  async progress(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: WorkerProgressDto,
  ) {
    return this.service.workerProgress(jobId, {
      progressPct: dto.progressPct,
      currentPhase: dto.currentPhase ?? null,
    });
  }

  @Post(':jobId/findings')
  @HttpCode(HttpStatus.OK)
  async findings(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: WorkerFindingsDto,
  ) {
    return this.service.workerFindings(
      jobId,
      // The service performs deep validation + normalization per finding.
      (dto.findings ?? []) as never[],
      dto.hosts as never[] | undefined,
      dto.errors as never[] | undefined,
    );
  }

  @Post(':jobId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: WorkerCompleteDto,
  ) {
    return this.service.workerComplete(
      jobId,
      dto.status,
      (dto.summary as SkyNetSummary | null) ?? null,
      (dto.findingCounts as ActiveScanFindingCounts | null) ?? null,
      dto.errorReason ?? null,
      dto.errorLog ?? null,
    );
  }
}
