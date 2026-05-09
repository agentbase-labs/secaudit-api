import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request as ExpressReq } from 'express';
import { ApiErrorCodes, AssetType, RequestStatus, TestingType, UserRole } from '@cs-platform/shared';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReportsService } from '../reports/reports.service';
import { RequestsService } from '../requests/requests.service';
import { AdminRequestsService } from './admin-requests.service';
import {
  CreateReportDto,
  RegeneratePasswordDto,
  ReportUploadUrlDto,
} from './dto/create-report.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

const PDF_MAX_BYTES = 50 * 1024 * 1024;

/** Minimal Multer file shape (avoids adding @types/multer). */
interface UploadedPdfFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@UseGuards(JwtAuthGuard, EmailVerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminRequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly adminRequests: AdminRequestsService,
    private readonly reports: ReportsService,
  ) {}

  // ---- /admin/requests ----

  @Get('requests')
  async list(
    @Query('status') status?: RequestStatus,
    @Query('assetType') assetType?: AssetType,
    @Query('testingType') testingType?: TestingType,
    @Query('userId') userId?: string,
    @Query('q') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.requests.listForAdmin({
      status,
      assetType,
      testingType,
      userId,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('requests/:id')
  @Audit('request.view_credentials')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.getForAdmin(id, /* revealCreds */ true);
  }

  @Patch('requests/:id/status')
  @Audit('request.status_update')
  async updateStatus(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.adminRequests.updateStatus(me.id, id, dto.status, dto.note, req.ip ?? null);
  }

  /**
   * NEW (Phase 1): admin uploads the final PDF as multipart/form-data.
   * Server qpdf-encrypts with an auto-generated 16-char password and emails
   * the client (link + password in two separate messages).
   *
   * Multer in-memory storage is fine for 50MB — no temp file management.
   */
  @Post('requests/:id/report')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PDF_MAX_BYTES, files: 1 },
    }),
  )
  async uploadReport(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedPdfFile | undefined,
  ) {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Missing file (multipart field "file" required)',
      });
    }
    return this.reports.uploadReportFromBuffer(
      me.id,
      id,
      {
        buffer: file.buffer,
        size: file.size,
        originalName: file.originalname,
        mimetype: file.mimetype,
      },
      req.ip ?? null,
    );
  }

  /** Legacy: signed-URL flow URL issuance. */
  @Post('requests/:id/report-upload-url')
  async reportUploadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportUploadUrlDto,
  ) {
    if (dto.contentType !== 'application/pdf') {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'contentType must be application/pdf',
      });
    }
    return this.reports.createUploadUrl(id, dto);
  }

  /** Legacy: confirm a signed-URL upload. */
  @Post('requests/:id/reports')
  @HttpCode(HttpStatus.CREATED)
  @Audit('report.upload')
  async createReport(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.createReport(me.id, id, dto, req.ip ?? null);
  }

  @Post('requests/:id/complete')
  @HttpCode(HttpStatus.OK)
  @Audit('request.complete')
  async complete(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    return this.adminRequests.updateStatus(
      me.id,
      id,
      RequestStatus.COMPLETED,
      body?.note,
      req.ip ?? null,
    );
  }

  // ---- /admin/reports ----

  /**
   * Admin report detail (metadata + decrypted password + audit log preview).
   * The plaintext password is included so the admin UI can show the
   * "Reveal password" toggle without round-tripping back to the client.
   */
  @Get('reports/:id')
  async getReport(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminRequests.getReportDetail(me.id, id, req.ip ?? null);
  }

  @Post('reports/:reportId/regenerate-password')
  @HttpCode(HttpStatus.OK)
  @Audit('report.password_regenerated')
  async regeneratePassword(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: RegeneratePasswordDto,
  ) {
    return this.reports.regeneratePassword(me.id, reportId, dto.reason, req.ip ?? null);
  }
}
