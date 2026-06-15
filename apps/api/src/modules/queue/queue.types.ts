export const JOB_QUEUE = 'JobQueue';

export type JobName =
  | 'scan.website'
  | 'scan.mobile'
  | 'scan.api'
  | 'scan.attack_surface'
  | 'scan.external_infra'
  | 'report.generate'
  | 'active_scan.run';

export interface JobDataMap {
  'scan.website': { requestId: string; url: string; env: 'prod' | 'test'; loginRef?: string };
  'scan.mobile': { requestId: string; platform: 'android' | 'ios'; mobileFileKey: string };
  'scan.api': { requestId: string; baseUrl: string; authRef?: string };
  'scan.attack_surface': { requestId: string; domain: string };
  'scan.external_infra': { requestId: string; ips: string[] };
  'report.generate': { requestId: string; scanArtifactKey: string };
  // Active/Deep scan: the isolated SkyNet worker PULLS this job from Redis,
  // claims it via the internal endpoint, runs the scan, and POSTs results
  // back (ACTIVE_SCAN_DESIGN.md §5.3). Payload is just the jobId — the worker
  // claims to fetch the verified host + token snapshot + scope.
  'active_scan.run': { jobId: string };
}

export interface EnqueueOptions {
  priority?: number;
  delayMs?: number;
  attempts?: number;
  backoffMs?: number;
  idempotencyKey?: string;
}

export interface JobHandle {
  id: string;
  name: JobName;
  enqueuedAt: Date;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
}

export interface JobQueue {
  enqueue<N extends JobName>(
    name: N,
    data: JobDataMap[N],
    opts?: EnqueueOptions,
  ): Promise<JobHandle>;
  status(jobId: string): Promise<JobHandle | null>;
  cancel(jobId: string): Promise<boolean>;
}
