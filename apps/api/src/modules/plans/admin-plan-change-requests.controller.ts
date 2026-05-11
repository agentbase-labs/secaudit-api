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
import { PlanChangeRequestStatus, UserRole } from '@cs-platform/shared';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ApprovePcrDto, RejectPcrDto } from './dto/process-pcr.dto';
import { PlanChangeRequestsService } from './plan-change-requests.service';

@UseGuards(JwtAuthGuard, EmailVerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/plan-change-requests')
export class AdminPlanChangeRequestsController {
  constructor(private readonly svc: PlanChangeRequestsService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const normalized =
      status && Object.values(PlanChangeRequestStatus).includes(status as PlanChangeRequestStatus)
        ? (status as PlanChangeRequestStatus)
        : undefined;
    return this.svc.list({
      status: normalized,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Audit('admin.pcr_approve')
  async approve(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePcrDto,
  ) {
    const { pcr, subscription } = await this.svc.approve({
      pcrId: id,
      adminId: me.id,
      notes: dto.notes,
      ip: req.ip ?? null,
    });
    return {
      id: pcr.id,
      status: pcr.status,
      processedAt: pcr.processedAt?.toISOString() ?? null,
      processedBy: pcr.processedBy,
      subscription: {
        id: subscription.id,
        userId: subscription.userId,
        planId: subscription.planId,
        billingCycle: subscription.billingCycle,
        status: subscription.status,
        startedAt: subscription.startedAt.toISOString(),
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      },
    };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Audit('admin.pcr_reject')
  async reject(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPcrDto,
  ) {
    const pcr = await this.svc.reject({
      pcrId: id,
      adminId: me.id,
      notes: dto.notes,
      ip: req.ip ?? null,
    });
    return {
      id: pcr.id,
      status: pcr.status,
      processedAt: pcr.processedAt?.toISOString() ?? null,
      processedBy: pcr.processedBy,
      notes: pcr.notes,
    };
  }
}
