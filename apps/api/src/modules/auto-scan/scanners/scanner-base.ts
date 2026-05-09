import type {
  AutoScanCategory,
  AutoScanSeverity,
  AutoScanSource,
  ScannerOutcome,
} from '@cs-platform/shared';

export interface ScannerFinding {
  source: AutoScanSource;
  severity: AutoScanSeverity;
  category: AutoScanCategory;
  title: string;
  description?: string | null;
  evidence?: Record<string, unknown> | null;
  remediation?: string | null;
  referenceUrls?: string[];
}

export interface ScannerResult {
  source: AutoScanSource;
  outcome: ScannerOutcome;
  findings: ScannerFinding[];
  durationMs: number;
  error?: string;
  /** Optional structured side-data (Mozilla score, SSL grade, subdomains) */
  meta?: Record<string, unknown>;
}

export interface ScanTarget {
  url: string;
  /** Hostname extracted from url. */
  host: string;
  /** Apex/registrable domain (best-effort). */
  domain: string;
}

export interface ScannerContext {
  target: ScanTarget;
  /** Per-scanner timeout in ms. */
  timeoutMs: number;
  /** Logger handle (NestJS Logger or compatible). */
  log: (msg: string) => void;
}

/**
 * Run a promise with a hard timeout. Resolves to the original value or
 * throws a `TimeoutError`-shaped error.
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let to: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    to = setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms);
  });
  try {
    return (await Promise.race([p, timeout])) as T;
  } finally {
    if (to) clearTimeout(to);
  }
}

/** Wrap fetch with a per-call timeout via AbortSignal. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    ...rest,
    signal: ctrl.signal,
    redirect: rest.redirect ?? 'follow',
  }).finally(() => clearTimeout(t));
}

/** Helper to assemble a successful result. */
export function ok(
  source: AutoScanSource,
  findings: ScannerFinding[],
  startedAt: number,
  meta?: Record<string, unknown>,
): ScannerResult {
  return {
    source,
    outcome: 'ok',
    findings,
    durationMs: Date.now() - startedAt,
    meta,
  };
}

export function failed(
  source: AutoScanSource,
  err: unknown,
  startedAt: number,
): ScannerResult {
  return {
    source,
    outcome: 'failed',
    findings: [],
    durationMs: Date.now() - startedAt,
    error: err instanceof Error ? err.message : String(err),
  };
}
