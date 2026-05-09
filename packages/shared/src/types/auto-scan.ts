/**
 * Auto-recon Phase 1 types — automated reconnaissance + light vulnerability
 * scanning that runs in the background after a website request is created.
 *
 * Findings are NEVER exposed in raw form to clients. The client-facing
 * summary endpoint returns ONLY scores + counts, not titles/evidence.
 */

export type AutoScanRunStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'partial'
  | 'failed';

export type AutoScanSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type AutoScanCategory =
  | 'misconfig'
  | 'exposure'
  | 'cve'
  | 'tls'
  | 'dns'
  | 'header'
  | 'cookie'
  | 'fingerprint'
  | 'subdomain'
  | 'other';

export type AutoScanSource =
  | 'http_fingerprint'
  | 'dns_recon'
  | 'tls_cert'
  | 'crt_sh'
  | 'mozilla_observatory'
  | 'ssl_labs'
  | 'nuclei'
  | 'nikto';

export type ScannerOutcome = 'ok' | 'failed' | 'skipped' | 'timeout';

export interface AutoScanFindingCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AutoScanScores {
  mozilla_observatory?: { grade: string; score: number } | null;
  ssl_labs?: { grade: string } | null;
}

export interface AutoScanFinding {
  id: string;
  requestId: string;
  scanId: string;
  source: AutoScanSource;
  severity: AutoScanSeverity;
  category: AutoScanCategory;
  title: string;
  description: string | null;
  evidence: Record<string, unknown> | null;
  remediation: string | null;
  referenceUrls: string[];
  promotedToReport: boolean;
  dismissed: boolean;
  dismissedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutoScanRun {
  id: string;
  requestId: string;
  status: AutoScanRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  tier1Status: Record<AutoScanSource, ScannerOutcome> | Record<string, ScannerOutcome> | null;
  tier2Status: Record<string, ScannerOutcome> | null;
  findingCounts: AutoScanFindingCounts | null;
  scores: AutoScanScores | null;
  errorLog: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Admin view: full run + all findings for a request. */
export interface AdminAutoScanResponse {
  run: AutoScanRun | null;
  findings: AutoScanFinding[];
  history: AutoScanRun[];
}

/**
 * Client-facing summary — heavily redacted. NO titles, NO descriptions, NO
 * evidence. Only grades + severity-bucket counts. The intent is a trust
 * signal ("we ran initial recon, results are with the pentester now").
 */
export interface ClientAutoScanSummary {
  status: AutoScanRunStatus | 'not_started';
  completedAt: string | null;
  scores: {
    mozillaGrade: string | null; // grade only, no numeric score for clients
    sslLabsGrade: string | null;
  };
  findingCounts: AutoScanFindingCounts | null;
  totalFindings: number;
}

/** DTO for admin dismiss action. */
export interface DismissFindingInput {
  reason: string;
}
