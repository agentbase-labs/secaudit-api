/**
 * Bootstrap admin seed.
 * Reads ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD + ADMIN_FULL_NAME from env.
 * Idempotent: if the email exists, ensures role=admin + emailVerified=true; otherwise creates.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { AppDataSource } from './database/data-source';
import { User } from './modules/users/entities/user.entity';
import { hashPassword } from './common/utils/password';
import { UserRole } from '@cs-platform/shared';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME ?? 'Platform Admin';
  if (!email || !password) {
    console.error(
      'Missing ADMIN_EMAIL or ADMIN_INITIAL_PASSWORD in env. Aborting seed.',
    );
    process.exit(1);
  }

  await AppDataSource.initialize();
  try {
    const repo = AppDataSource.getRepository(User);
    const existing = await repo.findOne({ where: { email: email.toLowerCase() } });
    if (existing) {
      existing.role = UserRole.ADMIN;
      existing.emailVerified = true;
      existing.disabled = false;
      await repo.save(existing);
      console.log(`Admin exists → promoted: ${existing.email} (id=${existing.id})`);
    } else {
      const passwordHash = await hashPassword(password);
      const admin = repo.create({
        email: email.toLowerCase(),
        fullName,
        companyName: null,
        passwordHash,
        role: UserRole.ADMIN,
        emailVerified: true,
        disabled: false,
      });
      const saved = await repo.save(admin);
      console.log(`Admin created: ${saved.email} (id=${saved.id})`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
