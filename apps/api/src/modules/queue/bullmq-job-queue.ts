import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { EnqueueOptions, JobDataMap, JobHandle, JobName, JobQueue } from './queue.types';

/**
 * Redis-backed job queue (BullMQ) — the Phase-2 replacement for NoopJobQueue
 * referenced by the `TODO(phase2): swap for BullMqJobQueue` note.
 *
 * The backend ENQUEUES jobs onto a per-name BullMQ queue; the isolated worker
 * (a separate Render service, NOT built here) is the consumer: it pulls the
 * next `active_scan.run` job, claims it via the internal endpoint, runs the
 * scan, and POSTs results back (ACTIVE_SCAN_DESIGN.md §5.3). The backend never
 * opens a connection *into* the worker.
 *
 * IMPLEMENTATION NOTE — optional dependency:
 *   `bullmq` + `ioredis` are heavy optional deps. To keep `pnpm build` / tsc
 *   green WITHOUT the package installed in every environment, we load BullMQ
 *   via a guarded dynamic `require` at construction time. When the module is
 *   absent (or REDIS_URL is empty) the QueueModule wires `NoopJobQueue`
 *   instead, so nothing here breaks compilation. Install with:
 *       pnpm --filter @cs-platform/api add bullmq ioredis
 *   then set REDIS_URL and the QueueModule picks this up automatically.
 */
@Injectable()
export class BullMqJobQueue implements JobQueue, OnModuleDestroy {
  private readonly logger = new Logger('BullMqJobQueue');
  // Lazily-created BullMQ Queue instances, one per JobName.
  private readonly queues = new Map<string, unknown>();
  // The bullmq module (loaded dynamically). `any` is intentional: we avoid a
  // hard compile-time type dependency on an optional package.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly bullmq: any;
  private readonly connection: { url: string };

  constructor(redisUrl: string) {
    this.connection = { url: redisUrl };
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    this.bullmq = require('bullmq');
    this.logger.log('BullMqJobQueue initialized (Redis-backed)');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getQueue(name: JobName): any {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const { Queue } = this.bullmq;
    const q = new Queue(name, {
      connection: { url: this.connection.url },
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    this.queues.set(name, q);
    return q;
  }

  async enqueue<N extends JobName>(
    name: N,
    data: JobDataMap[N],
    opts?: EnqueueOptions,
  ): Promise<JobHandle> {
    const q = this.getQueue(name);
    const job = await q.add(name, data, {
      priority: opts?.priority,
      delay: opts?.delayMs,
      attempts: opts?.attempts ?? 1,
      backoff: opts?.backoffMs ? { type: 'fixed', delay: opts.backoffMs } : undefined,
      jobId: opts?.idempotencyKey,
    });
    return {
      id: String(job.id ?? randomUUID()),
      name,
      enqueuedAt: new Date(),
      status: 'queued',
    };
  }

  async status(jobId: string): Promise<JobHandle | null> {
    // Search across known queues for the job.
    for (const [name, q] of this.queues.entries()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job = await (q as any).getJob(jobId);
      if (job) {
        const state = await job.getState();
        return {
          id: jobId,
          name: name as JobName,
          enqueuedAt: new Date(job.timestamp ?? Date.now()),
          status: mapState(state),
        };
      }
    }
    return null;
  }

  async cancel(jobId: string): Promise<boolean> {
    for (const q of this.queues.values()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job = await (q as any).getJob(jobId);
      if (job) {
        await job.remove();
        return true;
      }
    }
    return false;
  }

  async onModuleDestroy(): Promise<void> {
    for (const q of this.queues.values()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (q as any).close();
      } catch {
        /* best-effort */
      }
    }
  }
}

function mapState(state: string): JobHandle['status'] {
  switch (state) {
    case 'waiting':
    case 'delayed':
    case 'waiting-children':
      return 'queued';
    case 'active':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}
