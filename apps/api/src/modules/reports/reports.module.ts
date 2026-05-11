import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestingRequest } from '../requests/entities/testing-request.entity';
import { User } from '../users/entities/user.entity';
import { Report } from './entities/report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ManualReportGenerator, REPORT_GENERATOR } from './report-generator';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [TypeOrmModule.forFeature([Report, TestingRequest, User]), PlansModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    { provide: REPORT_GENERATOR, useClass: ManualReportGenerator },
  ],
  exports: [ReportsService, TypeOrmModule],
})
export class ReportsModule {}
