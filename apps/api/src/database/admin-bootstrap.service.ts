/**
 * AdminBootstrapService — idempotent admin seeder that runs once on application
 * bootstrap. If ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD are present in the
 * environment AND ADMIN_BOOTSTRAP_ENABLED !== 'false' (default true), this
 * ensures the configured admin user exists with role=admin and emailVerified=true.
 *
 * Idempotent: if the email already exists, only re-promotes (sets role=admin,
 * emailVerified=true, disabled=false). Never overwrites the password on an
 * existing user — the bootstrap password is ONLY used for the very first
 * creation. To rotate, change the password through the admin UI and remove
 * ADMIN_INITIAL_PASSWORD from the env.
 *
 * This is the production replacement for the manual `pnpm seed` step.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserRole } from '@cs-platform/shared';
import { hashPassword } from '../common/utils/password';
import { User } from '../modules/users/entities/user.entity';

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled = (process.env.ADMIN_BOOTSTRAP_ENABLED ?? 'true').toLowerCase() !== 'false';
    if (!enabled) {
      this.logger.log('Admin bootstrap disabled via ADMIN_BOOTSTRAP_ENABLED=false');
      return;
    }

    const email = process.env.ADMIN_EMAIL?.toLowerCase();
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    const fullName = process.env.ADMIN_FULL_NAME ?? 'Platform Admin';

    if (!email || !password) {
      this.logger.log('Admin bootstrap skipped: ADMIN_EMAIL or ADMIN_INITIAL_PASSWORD not set');
      return;
    }

    try {
      const existing = await this.users.findOne({ where: { email } });
      if (existing) {
        const wasNotAdmin =
          existing.role !== UserRole.ADMIN || !existing.emailVerified || existing.disabled;
        if (wasNotAdmin) {
          existing.role = UserRole.ADMIN;
          existing.emailVerified = true;
          existing.disabled = false;
          await this.users.save(existing);
          this.logger.log(`Admin user re-promoted: ${existing.email} (id=${existing.id})`);
        } else {
          this.logger.log(`Admin user already configured: ${existing.email}`);
        }
        return;
      }

      const passwordHash = await hashPassword(password);
      const admin = this.users.create({
        email,
        fullName,
        companyName: null,
        passwordHash,
        role: UserRole.ADMIN,
        emailVerified: true,
        disabled: false,
      });
      const saved = await this.users.save(admin);
      this.logger.log(`Admin user created: ${saved.email} (id=${saved.id})`);
    } catch (err) {
      // Never crash boot — log and continue. The app must come up even if
      // bootstrap fails (e.g. transient DB issue); the admin can be created
      // manually later.
      this.logger.error(
        `Admin bootstrap failed (non-fatal): ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
