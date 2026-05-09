import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@cs-platform/shared';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('health')
  async liveness() {
    return this.health.liveness();
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/system-health')
  async deep() {
    return this.health.deep();
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/audit-logs')
  async logs() {
    return this.audit.list({ page: 1, pageSize: 50 });
  }
}
