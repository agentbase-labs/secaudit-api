import {
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
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressReq } from 'express';
import { RequestStatus } from '@cs-platform/shared';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { PatchRequestDto } from './dto/patch-request.dto';
import { MobileUploadUrlDto } from './dto/upload-url.dto';
import { RequestsService } from './requests.service';

@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(
    @CurrentUser() me: CurrentUserData,
    @Query('status') status?: RequestStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.requests.listForUser(me.id, {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  async get(@CurrentUser() me: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.getForUser(me.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Audit('request.create')
  async create(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Body() dto: CreateRequestDto,
  ) {
    const user = await this.users.requireById(me.id);
    return this.requests.create(this.users.toPublic(user), dto, req.ip ?? null);
  }

  @Patch(':id')
  @Audit('request.patch')
  async patch(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchRequestDto,
  ) {
    return this.requests.patchForUser(me.id, id, { details: dto.details });
  }

  @Post(':id/mobile-upload-url')
  async mobileUploadUrl(
    @CurrentUser() me: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MobileUploadUrlDto,
  ) {
    return this.requests.getMobileUploadUrl(me.id, id, dto);
  }
}
