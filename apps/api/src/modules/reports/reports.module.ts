import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestingRequest } from '../requests/entities/testing-request.entity';
import { User } from '../users/entities/user.entity';
import { Report } from './entities/report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ManualReportGenerator, REPORT_GENERATOR } from './report-generator';

@Module({
  imports: [TypeOrmModule.forFeature([Report, TestingRequest, User])],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    { provide: REPORT_GENERATOR, useClass: ManualReportGenerator },
  ],
  exports: [ReportsService, TypeOrmModule],
})
export class ReportsModule {}
