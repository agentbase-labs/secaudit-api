import { Module } from '@nestjs/common';
import { DemoScanController } from './demo-scan.controller';
import { DemoScanService } from './demo-scan.service';

@Module({
  controllers: [DemoScanController],
  providers: [DemoScanService],
})
export class DemoScanModule {}
