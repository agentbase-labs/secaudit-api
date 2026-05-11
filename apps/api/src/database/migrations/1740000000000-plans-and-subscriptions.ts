import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plans + subscriptions schema (Step 1 + Step 2 of doc 03 §8 rollout).
 *
 *  - Creates: plans, subscriptions, usage_counters, plan_change_requests.
 *  - Seeds the 5 product tiers with caps EXACTLY from
 *    `design/plans/02-secaudit-plans.md` §1.
 *  - Backfills every existing user with a `Subscription{planId='free', status='active'}`
 *    (idempotent — re-running this migration on a fresh DB is safe).
 *
 * Notes:
 *  - Two pg ENUM types (subscription_status_enum, plan_change_request_status_enum).
 *    `billingCycle` is intentionally a varchar (not pg enum) — the zod literal in
 *    `@cs-platform/shared` is the source of truth, and varchar avoids ALTER TYPE
 *    pain when we add cycles (e.g. 'quarterly') later.
 *  - Partial unique indexes (`WHERE status='active'` / `WHERE status='pending'`)
 *    encode the "one active sub per user" / "one pending PCR per user" invariants.
 *  - `plans.id` is a slug PK — stable, readable, embeds cleanly in JWTs/logs.
 */
export class PlansAndSubscriptions1740000000000 implements MigrationInterface {
  name = 'PlansAndSubscriptions1740000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // 1. Enum types
    // ------------------------------------------------------------------
    await q.query(
      `CREATE TYPE "subscription_status_enum" AS ENUM ('active', 'pending_upgrade', 'cancelled')`,
    );
    await q.query(
      `CREATE TYPE "plan_change_request_status_enum" AS ENUM ('pending', 'approved', 'rejected')`,
    );

    // ------------------------------------------------------------------
    // 2. plans (slug PK, JSONB caps)
    // ------------------------------------------------------------------
    await q.query(`
      CREATE TABLE "plans" (
        "id" varchar(32) PRIMARY KEY,
        "name" varchar(100) NOT NULL,
        "monthlyPriceUsdCents" integer NOT NULL,
        "annualPriceUsdCents" integer NOT NULL,
        "isPublic" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "caps" jsonb NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_plans_public_sort" ON "plans" ("isPublic","sortOrder")`,
    );

    // ------------------------------------------------------------------
    // 3. subscriptions
    // ------------------------------------------------------------------
    await q.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "planId" varchar(32) NOT NULL REFERENCES "plans"("id") ON DELETE RESTRICT,
        "status" "subscription_status_enum" NOT NULL DEFAULT 'active',
        "billingCycle" varchar(16),
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "currentPeriodEnd" TIMESTAMP WITH TIME ZONE,
        "cancelledAt" TIMESTAMP WITH TIME ZONE,
        "requestedPlanId" varchar(32),
        "stripeCustomerId" varchar(64),
        "stripePriceId" varchar(64),
        "stripeSubscriptionId" varchar(64),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_subs_user_status" ON "subscriptions" ("userId","status")`,
    );
    await q.query(
      `CREATE INDEX "ix_subs_period_end" ON "subscriptions" ("currentPeriodEnd")`,
    );
    // Partial unique: at most one active subscription per user.
    await q.query(`
      CREATE UNIQUE INDEX "ux_subs_user_active"
      ON "subscriptions" ("userId")
      WHERE "status" = 'active'
    `);

    // ------------------------------------------------------------------
    // 4. usage_counters
    // ------------------------------------------------------------------
    await q.query(`
      CREATE TABLE "usage_counters" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "periodStart" TIMESTAMP WITH TIME ZONE NOT NULL,
        "submissionsCount" integer NOT NULL DEFAULT 0,
        "sourceReviewsCount" integer NOT NULL DEFAULT 0,
        "manualPentestsCountYtd" integer NOT NULL DEFAULT 0,
        "mobileUploadBytesUsed" bigint NOT NULL DEFAULT 0,
        "lastResetAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX "ux_usage_user_period"
      ON "usage_counters" ("userId","periodStart")
    `);

    // ------------------------------------------------------------------
    // 5. plan_change_requests
    // ------------------------------------------------------------------
    await q.query(`
      CREATE TABLE "plan_change_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "fromPlanId" varchar(32) NOT NULL REFERENCES "plans"("id") ON DELETE RESTRICT,
        "toPlanId" varchar(32) NOT NULL REFERENCES "plans"("id") ON DELETE RESTRICT,
        "billingCycle" varchar(16) NOT NULL,
        "status" "plan_change_request_status_enum" NOT NULL DEFAULT 'pending',
        "notes" text,
        "processedAt" TIMESTAMP WITH TIME ZONE,
        "processedBy" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_pcr_status_created" ON "plan_change_requests" ("status","createdAt")`,
    );
    await q.query(
      `CREATE INDEX "ix_pcr_user_created" ON "plan_change_requests" ("userId","createdAt")`,
    );
    await q.query(`
      CREATE UNIQUE INDEX "ux_pcr_user_pending"
      ON "plan_change_requests" ("userId")
      WHERE "status" = 'pending'
    `);

    // ------------------------------------------------------------------
    // 6. Seed the 5 plans (caps from doc 02 §1 verbatim).
    //    Idempotent via ON CONFLICT — safe in dev/staging restoring a snapshot.
    // ------------------------------------------------------------------
    const upsert = async (
      id: string,
      name: string,
      monthlyCents: number,
      annualCents: number,
      sortOrder: number,
      caps: Record<string, unknown>,
    ) => {
      await q.query(
        `
        INSERT INTO "plans"
          ("id","name","monthlyPriceUsdCents","annualPriceUsdCents","isPublic","sortOrder","caps")
        VALUES ($1,$2,$3,$4,true,$5,$6::jsonb)
        ON CONFLICT ("id") DO UPDATE SET
          "name" = EXCLUDED."name",
          "monthlyPriceUsdCents" = EXCLUDED."monthlyPriceUsdCents",
          "annualPriceUsdCents" = EXCLUDED."annualPriceUsdCents",
          "isPublic" = EXCLUDED."isPublic",
          "sortOrder" = EXCLUDED."sortOrder",
          "caps" = EXCLUDED."caps",
          "updatedAt" = now()
        `,
        [id, name, monthlyCents, annualCents, sortOrder, JSON.stringify(caps)],
      );
    };

    // ---- Free ($0/mo) — doc 02 §2.1 ----
    await upsert('free', 'Free', 0, 0, 10, {
      submissionsPerMonth: 1,
      registeredAssetsMax: 1,
      manualPentestsPerYear: 0,
      mobileUploadMaxMb: 0,
      seatsMax: 1,
      retentionDays: 30,
      perTypeSubmissionsPerMonth: null,
      allowedAssetTypes: ['website', 'attack_surface'],
      allowedTestingTypes: ['vuln_scan'],
      redTeamEnabled: false,
      ssoEnabled: false,
      complianceReportEnabled: false,
      auditLogAccess: false,
      retestsPerRequest: 0,
      slaVulnBusinessDays: null,
      slaPentestBusinessDays: null,
      supportTier: 'community',
    });

    // ---- Starter ($49/mo, $499/yr) — doc 02 §2.2 ----
    await upsert('starter', 'Starter', 4900, 49900, 20, {
      submissionsPerMonth: 3,
      registeredAssetsMax: 2,
      manualPentestsPerYear: 0,
      mobileUploadMaxMb: 0,
      seatsMax: 1,
      retentionDays: 90,
      perTypeSubmissionsPerMonth: null,
      allowedAssetTypes: ['website', 'attack_surface', 'external_infra'],
      allowedTestingTypes: ['vuln_scan', 'api_test'],
      redTeamEnabled: false,
      ssoEnabled: false,
      complianceReportEnabled: false,
      auditLogAccess: false,
      retestsPerRequest: 1,
      slaVulnBusinessDays: 5,
      slaPentestBusinessDays: null,
      supportTier: 'email_72h',
    });

    // ---- Pro ($179/mo, $1,799/yr) — doc 02 §2.3 ----
    await upsert('pro', 'Pro', 17900, 179900, 30, {
      submissionsPerMonth: 10,
      registeredAssetsMax: 8,
      manualPentestsPerYear: 0,
      mobileUploadMaxMb: 200,
      seatsMax: 5,
      retentionDays: 365,
      perTypeSubmissionsPerMonth: {
        vuln_scan: 10,
        api_test: 5,
        source_review: 2,
      },
      allowedAssetTypes: ['website', 'attack_surface', 'external_infra', 'mobile_app'],
      allowedTestingTypes: ['vuln_scan', 'api_test', 'source_review'],
      redTeamEnabled: false,
      ssoEnabled: false,
      complianceReportEnabled: true,
      auditLogAccess: true,
      retestsPerRequest: 2,
      slaVulnBusinessDays: 3,
      slaPentestBusinessDays: null,
      supportTier: 'email_24h',
    });

    // ---- Business ($599/mo, $5,999/yr) — doc 02 §2.4 ----
    await upsert('business', 'Business', 59900, 599900, 40, {
      submissionsPerMonth: 30,
      registeredAssetsMax: 25,
      manualPentestsPerYear: 1,
      mobileUploadMaxMb: 500,
      seatsMax: 15,
      retentionDays: 1095,
      perTypeSubmissionsPerMonth: {
        source_review: 5,
        manual_pentest: 1,
      },
      allowedAssetTypes: ['website', 'attack_surface', 'external_infra', 'mobile_app'],
      allowedTestingTypes: ['vuln_scan', 'api_test', 'source_review', 'manual_pentest'],
      redTeamEnabled: false,
      ssoEnabled: false,
      complianceReportEnabled: true,
      auditLogAccess: true,
      retestsPerRequest: null,
      slaVulnBusinessDays: 2,
      slaPentestBusinessDays: 10,
      supportTier: 'priority_8h',
    });

    // ---- Enterprise (Contact sales) — doc 02 §2.5 ----
    await upsert('enterprise', 'Enterprise', 0, 0, 50, {
      submissionsPerMonth: 100,
      registeredAssetsMax: -1,
      manualPentestsPerYear: -1,
      mobileUploadMaxMb: 2048,
      seatsMax: -1,
      retentionDays: 2555,
      perTypeSubmissionsPerMonth: null,
      allowedAssetTypes: ['website', 'attack_surface', 'external_infra', 'mobile_app'],
      allowedTestingTypes: ['vuln_scan', 'api_test', 'source_review', 'manual_pentest', 'red_team'],
      redTeamEnabled: true,
      ssoEnabled: true,
      complianceReportEnabled: true,
      auditLogAccess: true,
      retestsPerRequest: null,
      slaVulnBusinessDays: 1,
      slaPentestBusinessDays: null,
      supportTier: 'dedicated_csm',
    });

    // ------------------------------------------------------------------
    // 7. Backfill: every existing user without an active sub gets a Free one.
    //    Idempotent (NOT EXISTS) — safe to re-run.
    // ------------------------------------------------------------------
    await q.query(`
      INSERT INTO "subscriptions"
        ("id","userId","planId","status","billingCycle","startedAt","currentPeriodEnd")
      SELECT
        gen_random_uuid(),
        u."id",
        'free',
        'active',
        NULL,
        COALESCE(u."createdAt", now()),
        NULL
      FROM "users" u
      WHERE NOT EXISTS (
        SELECT 1 FROM "subscriptions" s
        WHERE s."userId" = u."id" AND s."status" = 'active'
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "plan_change_requests"`);
    await q.query(`DROP TABLE IF EXISTS "usage_counters"`);
    await q.query(`DROP TABLE IF EXISTS "subscriptions"`);
    await q.query(`DROP TABLE IF EXISTS "plans"`);
    await q.query(`DROP TYPE IF EXISTS "plan_change_request_status_enum"`);
    await q.query(`DROP TYPE IF EXISTS "subscription_status_enum"`);
  }
}
