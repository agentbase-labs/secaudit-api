import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Report } from '../reports/entities/report.entity';
import { TestingRequest } from './entities/testing-request.entity';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { AutoScanModule } from '../auto-scan/auto-scan.module';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestingRequest, Report]),
    UsersModule,
    forwardRef(() => AutoScanModule),
    PlansModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService, TypeOrmModule],
})
export class RequestsModule {}
