import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlansModule } from '../plans/plans.module';
import { VerifiedTargetEntity } from './entities/verified-target.entity';
import { ActiveScanJobEntity } from './entities/active-scan-job.entity';
import { ActiveScanFindingEntity } from './entities/active-scan-finding.entity';
import { ActiveScanService } from './active-scan.service';
import { StreamTokenService } from './stream-token.service';
import {
  ActiveScanController,
  ActiveScanStreamController,
} from './active-scan.controller';
import { InternalActiveScanController } from './internal-active-scan.controller';
import { AdminActiveScanController } from './admin-active-scan.controller';
import { ActiveScanPlanGuard } from './guards/active-scan-plan.guard';
import { StreamTokenGuard } from './guards/stream-token.guard';
import { WorkerSecretGuard } from './guards/worker-secret.guard';

/**
 * Active / Deep Scan control plane (ACTIVE_SCAN_DESIGN.md §5–§7). Owns the
 * verified-target + scan-job + finding entities, the client/internal/admin
 * controllers, and the plan/stream/worker guards.
 *
 * Imports PlansModule for PlanCapsService (entitlement + atomic quota) and a
 * locally-registered JwtModule for minting/verifying SSE stream tokens. The
 * JOB_QUEUE provider is global (QueueModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VerifiedTargetEntity,
      ActiveScanJobEntity,
      ActiveScanFindingEntity,
    ]),
    // Local JwtModule: stream tokens are signed with an explicit secret at
    // sign/verify time (StreamTokenService), so registration options here are
    // just defaults — the service always passes `secret` explicitly.
    JwtModule.register({}),
    PlansModule,
  ],
  controllers: [
    ActiveScanController,
    ActiveScanStreamController,
    InternalActiveScanController,
    AdminActiveScanController,
  ],
  providers: [
    ActiveScanService,
    StreamTokenService,
    ActiveScanPlanGuard,
    StreamTokenGuard,
    WorkerSecretGuard,
  ],
  exports: [ActiveScanService],
})
export class ActiveScanModule {}
