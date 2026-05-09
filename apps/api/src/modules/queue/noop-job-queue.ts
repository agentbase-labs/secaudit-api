import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { EnqueueOptions, JobDataMap, JobHandle, JobName, JobQueue } from './queue.types';

@Injectable()
export class NoopJobQueue implements JobQueue {
  private readonly logger = new Logger('NoopJobQueue');

  async enqueue<N extends JobName>(
    name: N,
    data: JobDataMap[N],
    _opts?: EnqueueOptions,
  ): Promise<JobHandle> {
    // TODO(phase2): swap for BullMqJobQueue; writes to Redis and workers run jobs.
    this.logger.log(`[noop] enqueue ${name} payload=${JSON.stringify(data)}`);
    return {
      id: randomUUID(),
      name,
      enqueuedAt: new Date(),
      status: 'queued',
    };
  }

  async status(_jobId: string): Promise<JobHandle | null> {
    return null;
  }

  async cancel(_jobId: string): Promise<boolean> {
    return false;
  }
}
