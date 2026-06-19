/**
 * Active / Deep Scan types — the PAID, AUTHORIZED, intrusive scan feature.
 *
 * Source of truth: `secaudit/ACTIVE_SCAN_DESIGN.md` (§3 ownership verification,
 * §4 data model, §4.4 normalized findings contract, §5 API, §7 plan gating).
 *
 * Severity reuses `AutoScanSeverity` (`info|low|medium|high|critical`) and the
 * severity-bucket counts reuse `AutoScanFindingCounts` from `./auto-scan`.
 *
 * NOTE FOR PHASE 3 (frontend): this file is the API contract. The web repo
 * (`secaudit-xyz`) must sync these types (its own `@cs-platform/shared` copy)
 * before consuming the endpoints.
 */

import type { AutoScanSeverity, AutoScanFindingCounts } from './auto-scan';

// ───────────────────────────── Verified targets ─────────────────────────────

export type VerifiedTargetStatus = 'pending' | 'verified' | 'expired' | 'revoked';
export type VerifiedTargetMethod = 'dns_txt' | 'http_file';

/**
 * Current active-scan authorization attestation version. The user flow captures
 * a user-supplied `authorizationVersion` per scan request (legal evidence on the
 * job). When an admin triggers a scan on a user's already-verified target
 * (reusing the user's proven ownership), the admin path attaches THIS version as
 * the authoritative current attestation. Bump on any material change to the
 * authorization/ToS text.
 */
export const ACTIVE_SCAN_AUTHORIZATION_VERSION = 'v1' as const;

/** Public DTO for a verified target row (no internal columns leaked). */
export interface VerifiedTarget {
  id: string;
  hostname: string;
  status: VerifiedTargetStatus;
  verifiedMethod: VerifiedTargetMethod | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Returned by `POST /active-scan/targets` and surfaced in the targets-manager
 * UI: both proof methods so the user can pick one.
 */
export interface VerifiedTargetWithInstructions extends VerifiedTarget {
  instructions: {
    /** The raw token (without the `secaudit-verify=` prefix). */
    token: string;
    dnsTxt: {
      /** Where to place the record (apex). */
      host: string;
      /** Exact record value to add. */
      value: string; // `secaudit-verify=<token>`
    };
    httpFile: {
      /** Absolute URL the user must serve. */
      url: string; // https://<host>/.well-known/secaudit-verify.txt
      path: string; // /.well-known/secaudit-verify.txt
      body: string; // `secaudit-verify=<token>`
    };
  };
}

/** Result of a verification attempt (`POST /active-scan/targets/:id/verify`). */
export interface VerifyTargetResult {
  verified: boolean;
  status: VerifiedTargetStatus;
  method: VerifiedTargetMethod | null;
  expiresAt: string | null;
  /** Human-readable detail on what was / wasn't found (failure case). */
  detail: string;
}

// ───────────────────────────── Scan jobs ────────────────────────────────────

export type ActiveScanJobStatus =
  | 'queued'
  | 'verifying'
  | 'running'
  | 'parsing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Non-terminal statuses (used for concurrency counting). */
export const ACTIVE_SCAN_ACTIVE_STATUSES: ActiveScanJobStatus[] = [
  'queued',
  'verifying',
  'running',
  'parsing',
];

/**
 * Scope params persisted on the job + handed to the worker. The worker honors
 * these AND the `saas` profile ceilings (`max_hosts_ceiling`, `rate_ceiling`).
 */
export interface ActiveScanScope {
  /** The verified host(s) the worker is allowed to touch. */
  allowlistHosts: string[];
  /** Hard per-job host cap (worker also clamps to profile ceiling). */
  maxHosts: number;
  /** SkyNet modules to run (defaults to all 13 in the saas profile). */
  modules: string[];
  /** Port spec ('default' = full deduped union). */
  ports: string;
  /** Conservative scan rate. */
  rate: number;
  /** When true, only low-noise checks run. */
  onlyLowNoise: boolean;
}

/** SkyNet `scan` metadata block (mirrors findings.normalized.json `scan`). */
export interface SkyNetSummary {
  jobId: string | null;
  profile: string;
  target?: string | null;
  verifiedHost: string;
  startedAt: string;
  completedAt: string;
  toolVersions: Record<string, string | null>;
  findingCounts?: ActiveScanFindingCounts | null;
  hosts?: SkyNetHostSummary[];
}

export interface SkyNetHostSummary {
  host: string;
  hostname: string | null;
  openPorts: Array<{
    port: number;
    proto: string;
    service: string | null;
    product: string | null;
  }>;
}

/**
 * Severity-bucket counts for an active scan. Extends the auto-scan counts with
 * a `total` so the UI can show "9 findings".
 */
export interface ActiveScanFindingCounts extends AutoScanFindingCounts {
  total?: number;
}

/** Public job DTO. */
export interface ActiveScanJob {
  id: string;
  targetId: string;
  verifiedHost: string;
  status: ActiveScanJobStatus;
  profile: string;
  planAtRequest: string;
  progressPct: number;
  currentPhase: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  findingCounts: ActiveScanFindingCounts | null;
  summary: SkyNetSummary | null;
  errorReason: string | null;
  authorizationAccepted: boolean;
  authorizationVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned by `POST /active-scan/scans`. */
export interface RequestScanResult {
  jobId: string;
  status: ActiveScanJobStatus;
  /** Short-lived signed token for the SSE stream (EventSource can't send Authorization). */
  streamToken: string;
}

/** Returned by `POST /active-scan/scans/:id/stream-token` (refresh). */
export interface StreamTokenResult {
  streamToken: string;
  /** Seconds until the token expires. */
  expiresIn: number;
}

// ───────────────────────────── Admin surface ────────────────────────────────

/**
 * A verified target enriched with its owning user's identity. Returned by
 * `GET /admin/active-scan/targets` so an admin can pick a user-verified target
 * to trigger a deep scan against. All timestamps are ISO strings.
 */
export interface AdminVerifiedTargetRow {
  id: string;
  userId: string;
  userEmail: string | null;
  userFullName: string | null;
  userCompanyName: string | null;
  hostname: string;
  status: VerifiedTargetStatus;
  verifiedMethod: VerifiedTargetMethod | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

/** Returned by `GET /admin/active-scan/targets`. */
export interface AdminListVerifiedTargetsResult {
  items: AdminVerifiedTargetRow[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Returned by `POST /admin/active-scan/scans`. Matches the user `RequestScanResult`
 * shape (jobId + status + streamToken so the frontend can open the SSE live view)
 * plus `targetUserId` so the admin UI knows which user the job belongs to.
 */
export interface AdminRequestScanResult {
  jobId: string;
  status: ActiveScanJobStatus;
  streamToken: string;
  targetUserId: string;
}

// ───────────────────────────── Findings ─────────────────────────────────────

/**
 * Normalized finding — field names match the SkyNet `findings.normalized.json`
 * contract (§4.4) AND the `active_scan_findings` table.
 */
export interface ActiveScanFinding {
  id: string;
  jobId: string;
  dedupKey: string;
  host: string;
  port: number | null;
  service: string | null;
  check: string;
  severity: AutoScanSeverity;
  source: string; // nmap|masscan|nuclei|nxc|odat|snmp-check|httpx|module:<name>
  title: string;
  description: string | null;
  evidence: Record<string, unknown> | null;
  remediation: string | null;
  referenceUrls: string[];
  createdAt: string;
}

/**
 * One finding as posted by the worker (the SkyNet `findings[]` entry). This is
 * the payload shape the internal `/findings` endpoint validates + persists.
 */
export interface WorkerFinding {
  dedupKey?: string; // worker computes; backend recomputes/validates
  target?: string | null;
  host: string;
  port?: number | null;
  service?: string | null;
  check: string;
  source: string;
  severity: AutoScanSeverity;
  title: string;
  description?: string | null;
  evidence?: Record<string, unknown> | null;
  remediation?: string | null;
  referenceUrls?: string[];
  firstSeen?: string;
  lastSeen?: string;
}

/** Full normalized findings document the worker emits (`findings.normalized.json`). */
export interface NormalizedFindingsDoc {
  schemaVersion: string;
  scan: SkyNetSummary;
  hosts: SkyNetHostSummary[];
  findings: WorkerFinding[];
  errors: Array<{
    phase: string;
    tool?: string | null;
    message: string;
    fatal?: boolean;
  }>;
}

/** Findings list response — grouped by host, paginated at the job level. */
export interface ActiveScanFindingsResponse {
  job: ActiveScanJob;
  findings: ActiveScanFinding[];
  /** Findings grouped by host then port (for the report UI). */
  byHost: Array<{
    host: string;
    hostname: string | null;
    ports: Array<{
      port: number | null;
      service: string | null;
      findings: ActiveScanFinding[];
    }>;
  }>;
}

// ───────────────────────────── SSE envelope ─────────────────────────────────

/**
 * SSE event envelope — reuses the demo scanner `{ type, data }` shape and
 * extends the type set (§5.3).
 */
export type ActiveScanSseType =
  | 'status'
  | 'progress'
  | 'finding'
  | 'phase_error'
  | 'complete'
  | 'error';

export interface ActiveScanSseEnvelope<T = unknown> {
  type: ActiveScanSseType;
  data: T;
}

export interface ActiveScanStatusEvent {
  status: ActiveScanJobStatus;
  progressPct: number;
  currentPhase: string | null;
}

export interface ActiveScanProgressEvent {
  progressPct: number;
  currentPhase: string | null;
}

export interface ActiveScanPhaseErrorEvent {
  phase: string;
  message: string;
}

export interface ActiveScanCompleteEvent {
  status: ActiveScanJobStatus;
  findingCounts: ActiveScanFindingCounts | null;
  durationMs: number | null;
}

export interface ActiveScanErrorEvent {
  message: string;
}

// ───────────────────────── Worker↔backend internal contract ─────────────────

/** Response from the worker `POST /internal/active-scan/:jobId/claim`. */
export interface WorkerClaimResponse {
  jobId: string;
  status: ActiveScanJobStatus;
  verifiedHost: string;
  verifyTokenSnapshot: string;
  verifiedMethod: VerifiedTargetMethod | null;
  /**
   * SECURITY: true when an admin manually authorized this scan against an
   * unverified/expired target (admin authority override). The worker MUST skip
   * live ownership re-assertion (TOCTOU re-check) for such jobs. Always false
   * for normal user-requested jobs, which stay fully ownership-enforced.
   */
  ownershipBypassed: boolean;
  scope: ActiveScanScope;
}

/** Worker `POST /internal/active-scan/:jobId/progress` body. */
export interface WorkerProgressBody {
  progressPct: number;
  currentPhase: string | null;
}

/** Worker `POST /internal/active-scan/:jobId/findings` body (batch). */
export interface WorkerFindingsBody {
  findings: WorkerFinding[];
  /** Optional host summaries to merge into the job summary. */
  hosts?: SkyNetHostSummary[];
  /** Optional non-fatal phase errors. */
  errors?: Array<{ phase: string; tool?: string | null; message: string; fatal?: boolean }>;
}

/** Worker `POST /internal/active-scan/:jobId/complete` body. */
export interface WorkerCompleteBody {
  status: 'completed' | 'failed';
  summary?: SkyNetSummary | null;
  findingCounts?: ActiveScanFindingCounts | null;
  errorReason?: string | null;
  errorLog?: string | null;
}
