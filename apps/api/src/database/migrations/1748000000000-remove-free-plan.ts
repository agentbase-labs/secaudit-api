import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove the `free` plan (hard removal).
 *
 * Business decision: there is no more "Free" tier. New signups default to
 * `starter` and land in a pending admin-review flow. There are no existing
 * free users to preserve, so deleting the `free` plan row is safe.
 *
 * Implementation notes:
 *  - This DELETEs the `free` row from `plans`. It is idempotent (DELETE of a
 *    non-existent row is a no-op) and defensive: it first re-points any
 *    lingering references away from `free` so the FK (onDelete: RESTRICT)
 *    cannot block the delete in a non-clean environment.
 *  - `down()` re-inserts the `free` plan row, mirroring the original
 *    upsert('free','Free',0,0,10,{...}) seed from
 *    1740000000000-plans-and-subscriptions.ts so the change is reversible.
 *  - The historical 1740000000000 migration is intentionally left untouched.
 */
export class RemoveFreePlan1748000000000 implements MigrationInterface {
  name = 'RemoveFreePlan1748000000000';

  public async up(q: QueryRunner): Promise<void> {
    // Defensive: in a clean/production environment there are no free users,
    // but if any stale references exist, re-point them to `starter` so the
    // RESTRICT foreign keys do not block the delete. No-ops on a clean DB.
    await q.query(`UPDATE "subscriptions" SET "planId" = 'starter' WHERE "planId" = 'free'`);
    await q.query(
      `UPDATE "plan_change_requests" SET "fromPlanId" = 'starter' WHERE "fromPlanId" = 'free'`,
    );
    await q.query(
      `UPDATE "plan_change_requests" SET "toPlanId" = 'starter' WHERE "toPlanId" = 'free'`,
    );

    // Hard removal of the free plan row. Idempotent.
    await q.query(`DELETE FROM "plans" WHERE "id" = 'free'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Re-insert the free plan row, mirroring the original seed
    // (upsert('free','Free',0,0,10,{...})) from the plans-and-subscriptions
    // migration so the removal is reversible.
    await q.query(
      `
      INSERT INTO "plans"
        ("id","name","monthlyPriceUsdCents","annualPriceUsdCents","isPublic","sortOrder","caps")
      VALUES ($1,$2,$3,$4,true,$5,$6::jsonb)
      ON CONFLICT ("id") DO NOTHING
      `,
      [
        'free',
        'Free',
        0,
        0,
        10,
        JSON.stringify({
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
        }),
      ],
    );
  }
}
