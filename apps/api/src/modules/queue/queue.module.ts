import { Global, Module } from '@nestjs/common';
import { NoopJobQueue } from './noop-job-queue';
import { JOB_QUEUE } from './queue.types';

@Global()
@Module({
  providers: [{ provide: JOB_QUEUE, useClass: NoopJobQueue }],
  exports: [JOB_QUEUE],
})
export class QueueModule {}
