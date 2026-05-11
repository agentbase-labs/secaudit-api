import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { UsageCounter } from './entities/usage-counter.entity';
import { PlanChangeRequest } from './entities/plan-change-request.entity';

import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { PlanChangeRequestsService } from './plan-change-requests.service';
import { PlanCapsService } from './plan-caps.service';

import { PlansController } from './plans.controller';
import { MeSubscriptionController } from './me-subscription.controller';
import { AdminPlanChangeRequestsController } from './admin-plan-change-requests.controller';

import { PlanCapGuard } from './guards/plan-cap.guard';
import { RetentionGuard } from './guards/retention.guard';
import { SeatsGuard } from './guards/seats.guard';

import { TestingRequest } from '../requests/entities/testing-request.entity';
import { Report } from '../reports/entities/report.entity';
import { UsersModule } from '../users/users.module';

/**
 * Owns Plan / Subscription / UsageCounter / PlanChangeRequest entities,
 * the public + me + admin controllers, and the cap-enforcement guards.
 *
 * Re-exports services + guards + TypeOrmModule so other modules
 * (auth, requests, reports) can wire them in directly.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Plan,
      Subscription,
      UsageCounter,
      PlanChangeRequest,
      // Foreign-feature entities the guards need to query.
      TestingRequest,
      Report,
    ]),
    UsersModule,
  ],
  controllers: [
    PlansController,
    MeSubscriptionController,
    AdminPlanChangeRequestsController,
  ],
  providers: [
    PlansService,
    SubscriptionsService,
    PlanChangeRequestsService,
    PlanCapsService,
    PlanCapGuard,
    RetentionGuard,
    SeatsGuard,
  ],
  exports: [
    PlansService,
    SubscriptionsService,
    PlanChangeRequestsService,
    PlanCapsService,
    PlanCapGuard,
    RetentionGuard,
    SeatsGuard,
    TypeOrmModule,
  ],
})
export class PlansModule {}
