import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 — PDF report encryption columns.
 *
 * 1. Renames `reports.r2Key` → `reports.encryptedPdfR2Key`.
 *    (The previously stored object in R2 is treated as the encrypted variant
 *    going forward; no data migration on R2 itself is required.)
 * 2. Adds `originalPdfR2Key` (admin-only key for the plaintext upload —
 *    enables password regeneration via "re-encrypt the original").
 * 3. Adds AES-GCM-encrypted password columns (ciphertext + iv + tag) plus
 *    `passwordCreatedAt` so the portal can show when the current password
 *    was issued.
 *
 * `passwordHash` is kept (nullable) so legacy reports with bcrypt-only
 * passwords keep working until they're regenerated.
 */
export class ReportEncryption1715000000000 implements MigrationInterface {
  name = 'ReportEncryption1715000000000';

  public async up(q: QueryRunner): Promise<void> {
    // 1) rename existing column
    await q.query(`ALTER TABLE "reports" RENAME COLUMN "r2Key" TO "encryptedPdfR2Key"`);

    // 2) new plaintext-PDF key (admin-only; never exposed to clients)
    await q.query(`ALTER TABLE "reports" ADD COLUMN "originalPdfR2Key" varchar`);

    // 3) AES-GCM ciphertext fields (base64-encoded). Nullable for legacy rows.
    await q.query(`ALTER TABLE "reports" ADD COLUMN "passwordCiphertext" text`);
    await q.query(`ALTER TABLE "reports" ADD COLUMN "passwordIv" varchar(64)`);
    await q.query(`ALTER TABLE "reports" ADD COLUMN "passwordTag" varchar(64)`);
    await q.query(
      `ALTER TABLE "reports" ADD COLUMN "passwordCreatedAt" TIMESTAMP WITH TIME ZONE`,
    );

    // 4) passwordHash becomes nullable (encrypted blob is now the source of truth)
    await q.query(`ALTER TABLE "reports" ALTER COLUMN "passwordHash" DROP NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "reports" ALTER COLUMN "passwordHash" SET NOT NULL`);
    await q.query(`ALTER TABLE "reports" DROP COLUMN "passwordCreatedAt"`);
    await q.query(`ALTER TABLE "reports" DROP COLUMN "passwordTag"`);
    await q.query(`ALTER TABLE "reports" DROP COLUMN "passwordIv"`);
    await q.query(`ALTER TABLE "reports" DROP COLUMN "passwordCiphertext"`);
    await q.query(`ALTER TABLE "reports" DROP COLUMN "originalPdfR2Key"`);
    await q.query(
      `ALTER TABLE "reports" RENAME COLUMN "encryptedPdfR2Key" TO "r2Key"`,
    );
  }
}
