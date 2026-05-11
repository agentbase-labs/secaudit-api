import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressReq } from 'express';
import { PlanChangeRequestStatus } from '@cs-platform/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ChangePlanDto } from './dto/change-plan.dto';
import { PlanChangeRequestsService } from './plan-change-requests.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Authenticated user-facing subscription endpoints.
 *
 * `POST /me/subscription/change` does NOT change the user's plan in MVP —
 * it creates a `PlanChangeRequest` for an admin to approve. See
 * `design/plans/03-plan-engineering.md` \u00a76.3.
 */
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
@Controller('me/subscription')
export class MeSubscriptionController {
  constructor(
    private readonly subs: SubscriptionsService,
    private readonly pcrs: PlanChangeRequestsService,
  ) {}

  @Get()
  async getMine(@CurrentUser() me: CurrentUserData) {
    return this.subs.getMeSubscription(me.id);
  }

  @Post('change')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async change(
    @CurrentUser() me: CurrentUserData,
    @Req() _req: ExpressReq,
    @Body() dto: ChangePlanDto,
  ) {
    const pcr = await this.pcrs.requestChange({
      userId: me.id,
      toPlanId: dto.toPlanId,
      billingCycle: dto.billingCycle,
      userNotes: dto.notes ? dto.notes.trim() : undefined,
    });
    return {
      id: pcr.id,
      fromPlanId: pcr.fromPlanId,
      toPlanId: pcr.toPlanId,
      billingCycle: pcr.billingCycle,
      status: pcr.status,
      createdAt: pcr.createdAt.toISOString(),
    };
  }

  @Post('cancel-change')
  @HttpCode(HttpStatus.OK)
  async cancelChange(@CurrentUser() me: CurrentUserData) {
    const result = await this.pcrs.cancelChange({ userId: me.id });
    return {
      success: result.success,
      cancelledAt: result.cancelledAt.toISOString(),
    };
  }

  @Get('changes')
  async listChanges(
    @CurrentUser() me: CurrentUserData,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const normalized =
      status && Object.values(PlanChangeRequestStatus).includes(status as PlanChangeRequestStatus)
        ? (status as PlanChangeRequestStatus)
        : undefined;
    return this.pcrs.listForUser({
      userId: me.id,
      status: normalized,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
