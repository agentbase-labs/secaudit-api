import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Subscription } from '../plans/entities/subscription.entity';
import { PlanChangeRequest } from '../plans/entities/plan-change-request.entity';
import { TestingRequest } from '../requests/entities/testing-request.entity';
import { Report } from '../reports/entities/report.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [
    UsersModule,
    // Repos the per-user detail endpoint reads from. AuditService is provided
    // globally (AuditModule is @Global), but we register the AuditLog repo here
    // so getDetail() can query the user's recent events directly.
    TypeOrmModule.forFeature([
      Subscription,
      PlanChangeRequest,
      TestingRequest,
      Report,
      AuditLog,
    ]),
  ],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
