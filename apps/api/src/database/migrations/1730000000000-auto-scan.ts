import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auto-recon Phase 1 — adds:
 *   - auto_scan_runs: one row per scan invocation per request
 *   - auto_scan_findings: individual findings (header miss, CVE hit, etc.)
 *
 * We deliberately do NOT add new values to request_status_enum. Auto-scan
 * progress lives in auto_scan_runs.status; the parent request stays in
 * `submitted` until an admin transitions it to `in_review` (existing
 * lifecycle). Keeping request.status untouched preserves the patch-lock
 * semantics (clients can still edit a request until admin takes over).
 */
export class AutoScan1730000000000 implements MigrationInterface {
  name = 'AutoScan1730000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "auto_scan_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requestId" uuid NOT NULL REFERENCES "testing_requests"("id") ON DELETE CASCADE,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "durationMs" integer,
        "tier1Status" jsonb,
        "tier2Status" jsonb,
        "findingCounts" jsonb,
        "scores" jsonb,
        "errorLog" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_auto_scan_runs_request" ON "auto_scan_runs" ("requestId")`,
    );
    await q.query(
      `CREATE INDEX "ix_auto_scan_runs_status_created" ON "auto_scan_runs" ("status","createdAt")`,
    );

    await q.query(`
      CREATE TABLE "auto_scan_findings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requestId" uuid NOT NULL REFERENCES "testing_requests"("id") ON DELETE CASCADE,
        "scanId" uuid NOT NULL REFERENCES "auto_scan_runs"("id") ON DELETE CASCADE,
        "source" varchar(50) NOT NULL,
        "severity" varchar(20) NOT NULL,
        "category" varchar(50) NOT NULL,
        "title" varchar(500) NOT NULL,
        "description" text,
        "evidence" jsonb,
        "remediation" text,
        "referenceUrls" text[] NOT NULL DEFAULT '{}',
        "promotedToReport" boolean NOT NULL DEFAULT false,
        "dismissed" boolean NOT NULL DEFAULT false,
        "dismissedReason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_auto_scan_findings_request" ON "auto_scan_findings" ("requestId")`,
    );
    await q.query(
      `CREATE INDEX "ix_auto_scan_findings_scan" ON "auto_scan_findings" ("scanId")`,
    );
    await q.query(
      `CREATE INDEX "ix_auto_scan_findings_severity_active" ON "auto_scan_findings" ("severity") WHERE NOT "dismissed"`,
    );
    await q.query(
      `CREATE INDEX "ix_auto_scan_findings_promoted" ON "auto_scan_findings" ("requestId") WHERE "promotedToReport" = true`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "auto_scan_findings"`);
    await q.query(`DROP TABLE IF EXISTS "auto_scan_runs"`);
  }
}
