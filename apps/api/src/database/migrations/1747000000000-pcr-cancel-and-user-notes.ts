import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PCR cancellation + user notes (Phase 2 of subscription self-service).
 *
 * Changes:
 *  1. Add 'cancelled' to the `plan_change_request_status_enum` PG enum.
 *  2. Add `cancelledAt TIMESTAMPTZ NULL` column to `plan_change_requests`.
 *  3. Add `userNotes TEXT NULL` column to `plan_change_requests`.
 *
 * Notes:
 *  - The shared-types enum `PlanChangeRequestStatus` already had CANCELLED='cancelled'
 *    defined, but the DB enum was created without it. This migration syncs the DB.
 *  - `userNotes` stores the user's reason for requesting a plan change (optional,
 *    max 500 chars enforced at the DTO layer). This is distinct from `notes` which
 *    is the admin decision note written on approve/reject.
 *  - `synchronize: false` in prod — all schema changes MUST be explicit migrations.
 */
export class PcrCancelAndUserNotes1747000000000 implements MigrationInterface {
  name = 'PcrCancelAndUserNotes1747000000000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Extend the PG enum to include 'cancelled'.
    //    ALTER TYPE … ADD VALUE is safe and non-blocking (cannot be in a transaction
    //    in older PG versions, but pg14+ used by Render is fine).
    await q.query(
      `ALTER TYPE "plan_change_request_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );

    // 2. Add cancelledAt column.
    await q.query(`
      ALTER TABLE "plan_change_requests"
      ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP WITH TIME ZONE
    `);

    // 3. Add userNotes column.
    await q.query(`
      ALTER TABLE "plan_change_requests"
      ADD COLUMN IF NOT EXISTS "userNotes" text
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Remove columns.
    await q.query(
      `ALTER TABLE "plan_change_requests" DROP COLUMN IF EXISTS "userNotes"`,
    );
    await q.query(
      `ALTER TABLE "plan_change_requests" DROP COLUMN IF EXISTS "cancelledAt"`,
    );
    // Note: PG does not support removing enum values — 'cancelled' value stays.
    // Rows with status='cancelled' should be manually migrated before rolling back.
  }
}
