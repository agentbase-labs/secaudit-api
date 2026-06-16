import { Global, Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { NoopJobQueue } from './noop-job-queue';
import { BullMqJobQueue } from './bullmq-job-queue';
import { JOB_QUEUE } from './queue.types';
import type { JobQueue } from './queue.types';

/**
 * Selects the job-queue implementation at boot:
 *   - REDIS_URL set AND `bullmq` installed → BullMqJobQueue (Redis-backed).
 *   - otherwise                            → NoopJobQueue (logs + no-op).
 *
 * This keeps `pnpm build` green without the optional `bullmq`/`ioredis` deps,
 * while enabling the real queue the moment they're installed + REDIS_URL is
 * configured. The active-scan worker is the consumer (separate Render
 * service); see ACTIVE_SCAN_DESIGN.md §5.3 / §6.
 */
@Global()
@Module({
  providers: [
    {
      provide: JOB_QUEUE,
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService): JobQueue => {
        const logger = new Logger('QueueModule');
        const redisUrl = (cfg.get('REDIS_URL') ?? '').trim();
        if (!redisUrl) {
          logger.warn('REDIS_URL not set — using NoopJobQueue (jobs are not dispatched).');
          return new NoopJobQueue();
        }
        try {
          // Verify the optional dep is present before constructing.
          // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
          require.resolve('bullmq');
          return new BullMqJobQueue(redisUrl);
        } catch {
          logger.error(
            'REDIS_URL is set but `bullmq` is not installed — falling back to NoopJobQueue. ' +
              'Run: pnpm --filter @cs-platform/api add bullmq ioredis',
          );
          return new NoopJobQueue();
        }
      },
    },
  ],
  exports: [JOB_QUEUE],
})
export class QueueModule {}
