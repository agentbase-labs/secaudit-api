import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Active / Deep Scan — admin ownership-bypass marker.
 *
 * Adds two columns to `active_scan_jobs` so an ADMIN can manually authorize a
 * deep scan on a target that is NOT verified (or whose verification expired):
 *   - ownershipBypassed   boolean NOT NULL DEFAULT false
 *       TRUE only for admin-authorized jobs. The worker reads this (via the
 *       /claim response) and SKIPS its live ownership re-assertion (TOCTOU
 *       re-check) for such jobs — the admin's manual action is the
 *       authorization of record. Normal user jobs keep full enforcement.
 *   - authorizedByAdminId uuid NULL
 *       The admin user id that authorized the bypass (audit of record).
 *
 * Follows the raw-SQL, reversible style of 1750000000000-active-scan.ts.
 */
export class ActiveScanAdminOwnershipBypass1751000000000
  implements MigrationInterface
{
  name = 'ActiveScanAdminOwnershipBypass1751000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "active_scan_jobs" ADD COLUMN IF NOT EXISTS "ownershipBypassed" boolean NOT NULL DEFAULT false`,
    );
    await q.query(
      `ALTER TABLE "active_scan_jobs" ADD COLUMN IF NOT EXISTS "authorizedByAdminId" uuid`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "active_scan_jobs" DROP COLUMN IF EXISTS "authorizedByAdminId"`,
    );
    await q.query(
      `ALTER TABLE "active_scan_jobs" DROP COLUMN IF EXISTS "ownershipBypassed"`,
    );
  }
}
