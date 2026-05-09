import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(q: QueryRunner): Promise<void> {
    // Extensions
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);

    // Enums
    await q.query(`CREATE TYPE "user_role_enum" AS ENUM ('client', 'admin')`);
    await q.query(
      `CREATE TYPE "asset_type_enum" AS ENUM ('attack_surface', 'website', 'external_infra', 'mobile_app')`,
    );
    await q.query(
      `CREATE TYPE "testing_type_enum" AS ENUM ('vuln_scan', 'manual_pentest', 'red_team', 'api_test', 'source_review')`,
    );
    await q.query(
      `CREATE TYPE "request_status_enum" AS ENUM (
        'submitted','in_review','testing_in_progress','report_ready','completed',
        'queued','running','generating','failed'
      )`,
    );

    // users
    await q.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "fullName" varchar(200) NOT NULL,
        "email" citext NOT NULL,
        "companyName" varchar(200),
        "passwordHash" varchar NOT NULL,
        "role" "user_role_enum" NOT NULL DEFAULT 'client',
        "emailVerified" boolean NOT NULL DEFAULT false,
        "disabled" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX "ux_users_email" ON "users" ("email")`);

    // email verification tokens
    await q.query(`
      CREATE TABLE "email_verification_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "tokenHash" varchar NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX "ix_evt_user" ON "email_verification_tokens" ("userId")`);

    // password reset tokens
    await q.query(`
      CREATE TABLE "password_reset_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "tokenHash" varchar NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "usedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX "ix_prt_user" ON "password_reset_tokens" ("userId")`);

    // refresh token families (for rotation + reuse detection)
    await q.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "family" uuid NOT NULL,
        "jti" uuid NOT NULL,
        "tokenHash" varchar NOT NULL,
        "replacedByJti" uuid,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX "ix_rt_user" ON "refresh_tokens" ("userId")`);
    await q.query(`CREATE INDEX "ix_rt_family" ON "refresh_tokens" ("family")`);
    await q.query(`CREATE UNIQUE INDEX "ux_rt_jti" ON "refresh_tokens" ("jti")`);

    // testing_requests
    await q.query(`
      CREATE TABLE "testing_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "assetType" "asset_type_enum" NOT NULL,
        "testingType" "testing_type_enum" NOT NULL,
        "status" "request_status_enum" NOT NULL DEFAULT 'submitted',
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_tr_user_status" ON "testing_requests" ("userId","status")`,
    );
    await q.query(
      `CREATE INDEX "ix_tr_status_created" ON "testing_requests" ("status","createdAt")`,
    );

    // reports
    await q.query(`
      CREATE TABLE "reports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requestId" uuid NOT NULL REFERENCES "testing_requests"("id") ON DELETE CASCADE,
        "r2Key" varchar NOT NULL,
        "fileSize" bigint NOT NULL,
        "passwordHash" varchar NOT NULL,
        "pdfSelfEncrypted" boolean NOT NULL DEFAULT false,
        "uploadedBy" uuid NOT NULL REFERENCES "users"("id"),
        "uploadedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "downloadCount" integer NOT NULL DEFAULT 0,
        "lastDownloadedAt" TIMESTAMP WITH TIME ZONE
      )
    `);
    await q.query(`CREATE INDEX "ix_reports_request" ON "reports" ("requestId")`);

    // audit_logs
    await q.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actorUserId" uuid,
        "action" varchar(100) NOT NULL,
        "targetType" varchar(50),
        "targetId" uuid,
        "ip" inet,
        "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_audit_actor_created" ON "audit_logs" ("actorUserId","createdAt")`,
    );
    await q.query(`CREATE INDEX "ix_audit_target" ON "audit_logs" ("targetType","targetId")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await q.query(`DROP TABLE IF EXISTS "reports"`);
    await q.query(`DROP TABLE IF EXISTS "testing_requests"`);
    await q.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await q.query(`DROP TABLE IF EXISTS "password_reset_tokens"`);
    await q.query(`DROP TABLE IF EXISTS "email_verification_tokens"`);
    await q.query(`DROP TABLE IF EXISTS "users"`);
    await q.query(`DROP TYPE IF EXISTS "request_status_enum"`);
    await q.query(`DROP TYPE IF EXISTS "testing_type_enum"`);
    await q.query(`DROP TYPE IF EXISTS "asset_type_enum"`);
    await q.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
