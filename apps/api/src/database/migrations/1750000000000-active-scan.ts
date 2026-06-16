import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Active / Deep Scan (ACTIVE_SCAN_DESIGN.md §4.5) — adds:
 *   - verified_targets:      user-owned domains + ownership-proof state
 *   - active_scan_jobs:      one row per on-demand active scan invocation
 *   - active_scan_findings:  normalized findings (deduped per job)
 *   - usage_counters.activeScansCount: monthly active-scan quota counter
 *   - plans.caps += { activeScansPerMonth, activeScanConcurrency,
 *                     activeScanMaxTargets } for every existing tier
 *
 * Follows the raw-SQL style of 1730000000000-auto-scan.ts /
 * 1740000000000-plans-and-subscriptions.ts: gen_random_uuid() PKs, explicit
 * indexes, reversible down().
 *
 * Plan caps (§7.2):
 *   starter    → 0 / 0 / 0   (active scanning disabled — paid-tier upsell)
 *   pro        → 5 / 1 / 3   (self-serve)
 *   business   → 25 / 2 / 25 (self-serve)
 *   enterprise → -1 / 5 / -1 (unlimited, self-serve)
 */
export class ActiveScan1750000000000 implements MigrationInterface {
  name = 'ActiveScan1750000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── verified_targets ──────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "verified_targets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "hostname" varchar(253) NOT NULL,
        "token" varchar(64) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "verifiedMethod" varchar(20),
        "tokenIssuedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "verifiedAt" TIMESTAMP WITH TIME ZONE,
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "lastCheckedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX "ux_verified_targets_user_host" ON "verified_targets" ("userId","hostname")`,
    );
    await q.query(
      `CREATE INDEX "ix_verified_targets_status" ON "verified_targets" ("status")`,
    );

    // ── active_scan_jobs ──────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "active_scan_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "targetId" uuid NOT NULL REFERENCES "verified_targets"("id") ON DELETE RESTRICT,
        "status" varchar(20) NOT NULL DEFAULT 'queued',
        "verifiedHost" varchar(253) NOT NULL,
        "verifyTokenSnapshot" varchar(64) NOT NULL,
        "planAtRequest" varchar(32) NOT NULL,
        "profile" varchar(20) NOT NULL DEFAULT 'saas',
        "scope" jsonb NOT NULL,
        "workerId" varchar(64),
        "progressPct" integer NOT NULL DEFAULT 0,
        "currentPhase" varchar(60),
        "queuedAt" TIMESTAMP WITH TIME ZONE,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "durationMs" integer,
        "findingCounts" jsonb,
        "summary" jsonb,
        "errorReason" text,
        "errorLog" text,
        "authorizationAccepted" boolean NOT NULL DEFAULT false,
        "authorizationVersion" varchar(64),
        "requestIp" varchar(64),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_active_scan_jobs_user_status" ON "active_scan_jobs" ("userId","status")`,
    );
    await q.query(
      `CREATE INDEX "ix_active_scan_jobs_status_created" ON "active_scan_jobs" ("status","createdAt")`,
    );
    await q.query(
      `CREATE INDEX "ix_active_scan_jobs_target" ON "active_scan_jobs" ("targetId")`,
    );

    // ── active_scan_findings ──────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "active_scan_findings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "jobId" uuid NOT NULL REFERENCES "active_scan_jobs"("id") ON DELETE CASCADE,
        "dedupKey" varchar(64) NOT NULL,
        "host" varchar(45) NOT NULL,
        "port" integer,
        "service" varchar(40),
        "check" varchar(80) NOT NULL,
        "severity" varchar(20) NOT NULL,
        "source" varchar(40) NOT NULL,
        "title" varchar(500) NOT NULL,
        "description" text,
        "evidence" jsonb,
        "remediation" text,
        "referenceUrls" text[] NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_active_scan_findings_job" ON "active_scan_findings" ("jobId")`,
    );
    await q.query(
      `CREATE INDEX "ix_active_scan_findings_job_sev" ON "active_scan_findings" ("jobId","severity")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "ux_active_scan_findings_dedup" ON "active_scan_findings" ("jobId","dedupKey")`,
    );

    // ── usage_counters.activeScansCount (monthly quota counter) ───────────
    await q.query(
      `ALTER TABLE "usage_counters" ADD COLUMN IF NOT EXISTS "activeScansCount" integer NOT NULL DEFAULT 0`,
    );

    // ── plans.caps += active-scan caps (per tier, §7.2) ───────────────────
    // Merge into existing JSONB so we don't clobber the other caps.
    const setCaps = async (
      planId: string,
      perMonth: number,
      concurrency: number,
      maxTargets: number,
    ) => {
      await q.query(
        `
        UPDATE "plans"
        SET "caps" = "caps"
          || jsonb_build_object(
               'activeScansPerMonth', $2::int,
               'activeScanConcurrency', $3::int,
               'activeScanMaxTargets', $4::int
             ),
          "updatedAt" = now()
        WHERE "id" = $1
        `,
        [planId, perMonth, concurrency, maxTargets],
      );
    };
    await setCaps('starter', 0, 0, 0);
    await setCaps('pro', 5, 1, 3);
    await setCaps('business', 25, 2, 25);
    await setCaps('enterprise', -1, 5, -1);
    // Defensive: if a legacy 'free' row still exists, disable active scans.
    await setCaps('free', 0, 0, 0);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Strip the active-scan caps from every plan row (reverse of the merge).
    await q.query(`
      UPDATE "plans"
      SET "caps" = "caps"
        - 'activeScansPerMonth'
        - 'activeScanConcurrency'
        - 'activeScanMaxTargets',
        "updatedAt" = now()
    `);
    await q.query(`ALTER TABLE "usage_counters" DROP COLUMN IF EXISTS "activeScansCount"`);
    await q.query(`DROP TABLE IF EXISTS "active_scan_findings"`);
    await q.query(`DROP TABLE IF EXISTS "active_scan_jobs"`);
    await q.query(`DROP TABLE IF EXISTS "verified_targets"`);
  }
}
