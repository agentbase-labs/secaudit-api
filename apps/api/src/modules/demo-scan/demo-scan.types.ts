export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info' | 'timeout' | 'error';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type CheckCategory = 'tls' | 'headers' | 'network' | 'email' | 'application' | 'compliance';

export interface CheckResult {
  check: string;
  status: CheckStatus;
  score: number; // 0-10
  title: string;
  detail: string;
  severity: Severity;
  category: CheckCategory;
  gated?: boolean;
}

export interface ComplianceScore {
  name: string;
  score: number;
  max: number;
  label: string;
  gated: boolean;
}

export interface CategorySummary {
  name: string;
  score: number;
  maxScore: number;
  checks: number;
  passed: number;
}

export interface ScanJob {
  jobId: string;
  url: string;
  domain: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  results: CheckResult[];
  overallScore?: number;
  grade?: string;
  categories?: CategorySummary[];
  compliance?: ComplianceScore[];
  createdAt: number;
  fromCache?: boolean;
}
