import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  Header,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { DemoScanService } from './demo-scan.service';
import { StartScanDto } from './demo-scan.dto';

@Controller('public/demo')
export class DemoScanController {
  constructor(private readonly service: DemoScanService) {}

  @Public()
  @Post('scan')
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  async startScan(@Body() dto: StartScanDto, @Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      '0.0.0.0';
    return this.service.startScan(dto.url, ip);
  }

  @Public()
  @Sse('scan/:jobId')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  async streamScan(@Param('jobId') jobId: string): Promise<Observable<MessageEvent>> {
    return this.service.streamResults(jobId);
  }
}
