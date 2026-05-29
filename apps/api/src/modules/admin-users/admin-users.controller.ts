import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressReq } from 'express';
import { UserRole } from '@cs-platform/shared';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminUsersService } from './admin-users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@UseGuards(JwtAuthGuard, EmailVerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getDetail(id);
  }

  @Get()
  async list(
    @Query('q') search?: string,
    @Query('role') role?: UserRole,
    @Query('disabled') disabled?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.users.list({
      search,
      role,
      disabled: disabled === undefined ? undefined : disabled === 'true',
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Patch(':id')
  @Audit('admin.user_update')
  async update(
    @CurrentUser() me: CurrentUserData,
    @Req() req: ExpressReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(me.id, id, dto, req.ip ?? null);
  }
}
