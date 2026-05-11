import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { ApiErrorCodes } from '@cs-platform/shared';
import type { BillingCycle, PlanSlug, PublicUser } from '@cs-platform/shared';

import { AppConfigService } from '../../config/config.service';
import { hashPassword, needsRehash, verifyPassword } from '../../common/utils/password';
import { generateRandomToken, sha256 } from '../../common/utils/tokens';
import { MAIL_SERVICE } from '../mail/mail.service';
import type { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../plans/subscriptions.service';
import { User } from '../users/entities/user.entity';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import type { AccessTokenPayload } from './strategies/jwt.strategy';

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  fam: string;
  iat?: number;
  exp?: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
    private readonly dataSource: DataSource,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    @InjectRepository(EmailVerificationToken)
    private readonly evtRepo: Repository<EmailVerificationToken>,
    @InjectRepository(PasswordResetToken)
    private readonly prtRepo: Repository<PasswordResetToken>,
    @InjectRepository(RefreshToken)
    private readonly rtRepo: Repository<RefreshToken>,
  ) {}

  // ---------------- Register ----------------

  async register(input: {
    fullName: string;
    email: string;
    password: string;
    companyName?: string;
    /** Optional pre-selected plan from /signup. See §6.2 of the eng doc. */
    planId?: PlanSlug;
    billingCycle?: BillingCycle;
    ip?: string | null;
  }): Promise<
    | { userId: string; autoLogin: false; pendingUpgrade: boolean; pendingPlan: PlanSlug | null }
    | {
        userId: string;
        autoLogin: true;
        user: PublicUser;
        tokens: IssuedTokens;
        pendingUpgrade: boolean;
        pendingPlan: PlanSlug | null;
      }
  > {
    const email = input.email.toLowerCase();

    // §11 decision #3 — enterprise self-serve registration is not allowed.
    if (input.planId === 'enterprise') {
      throw new BadRequestException({
        error: 'enterprise_requires_sales',
        message:
          'Enterprise requires a sales conversation. Please contact us at /contact.',
      });
    }

    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException({
        error: ApiErrorCodes.EMAIL_TAKEN,
        message: 'Email already registered',
      });
    }
    const passwordHash = await hashPassword(input.password);
    const verificationRequired = this.cfg.emailVerificationRequired;

    // Resolve whether a paid PCR should be created (§6.2 Path B).
    // (Enterprise was rejected above, so reaching here implies free|starter|pro|business.)
    const wantsPaidUpgrade = !!input.planId && input.planId !== 'free';
    const billingCycle: BillingCycle = input.billingCycle ?? 'monthly';

    // Create user + Free subscription (+ optional pending PCR) atomically
    // so a half-registered user can never exist.
    const { user, pendingUpgrade } = await this.dataSource.transaction(
      async (m) => {
        const userEntity = m.create(User, {
          fullName: input.fullName,
          email,
          companyName: input.companyName?.trim() || null,
          passwordHash,
          emailVerified: !verificationRequired,
        });
        const savedUser = await m.save(userEntity);

        // Always live on Free initially — even paid signups.
        await this.subscriptions.createInitialFreeInTx(m, savedUser.id, new Date());

        let pendingUpgrade = false;
        if (wantsPaidUpgrade) {
          await this.subscriptions.createOrSupersedePendingPcr({
            em: m,
            userId: savedUser.id,
            fromPlanId: 'free',
            toPlanId: input.planId!,
            billingCycle,
          });
          pendingUpgrade = true;
        }
        return { user: savedUser, pendingUpgrade };
      },
    );

    if (verificationRequired) {
      await this.issueEmailVerification(user.id, user.email, user.fullName);
    }

    await this.audit.record({
      actorUserId: user.id,
      action: 'user.register',
      ip: input.ip ?? null,
      meta: {
        email: user.email,
        ...(input.planId ? { requestedPlanId: input.planId, billingCycle } : {}),
      },
    });

    // Best-effort ops notification on paid upgrade requests (Path B §6.2).
    if (wantsPaidUpgrade) {
      void this.mail
        .sendTemplate({
          to: this.cfg.get('CONTACT_INBOX_EMAIL'),
          template: 'contact-received',
          data: {
            name: input.fullName,
            email: user.email,
            companyName: input.companyName ?? undefined,
            message: `New signup requesting upgrade to ${input.planId} (${billingCycle}). userId=${user.id}`,
          },
          replyTo: user.email,
        })
        .catch(() => undefined);
    }

    const pendingPlan: PlanSlug | null =
      wantsPaidUpgrade && input.planId ? input.planId : null;

    if (verificationRequired) {
      return {
        userId: user.id,
        autoLogin: false,
        pendingUpgrade,
        pendingPlan,
      };
    }

    // Auto-login: issue the same token pair `login()` would and let the
    // controller set the refresh cookie. Audit as a login so the trail is
    // consistent with normal sign-in.
    const tokens = await this.issueTokenPair(
      user.id,
      user.email,
      user.role,
      user.emailVerified,
    );
    await this.audit.record({
      actorUserId: user.id,
      action: 'user.login',
      ip: input.ip ?? null,
      meta: { via: 'register' },
    });
    return {
      userId: user.id,
      autoLogin: true,
      user: this.users.toPublic(user),
      tokens,
      pendingUpgrade,
      pendingPlan,
    };
  }

  private async issueEmailVerification(
    userId: string,
    email: string,
    fullName: string,
  ): Promise<void> {
    const token = generateRandomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.evtRepo.insert({ userId, tokenHash, expiresAt });

    const verifyUrl = `${this.cfg.get('APP_URL')}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mail
      .sendTemplate({
        to: email,
        template: 'verify-email',
        data: { fullName, verifyUrl, expiresHours: 24 },
      })
      .catch((e) => this.logger.warn(`verify-email send failed: ${(e as Error).message}`));
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.emailVerified) return;
    await this.issueEmailVerification(user.id, user.email, user.fullName);
  }

  async verifyEmail(token: string): Promise<void> {
    const tokenHash = sha256(token);
    const row = await this.evtRepo.findOne({ where: { tokenHash } });
    if (!row) {
      throw new BadRequestException({
        error: ApiErrorCodes.TOKEN_INVALID,
        message: 'Invalid token',
      });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      await this.evtRepo.delete(row.id);
      throw new GoneException({
        error: ApiErrorCodes.TOKEN_EXPIRED,
        message: 'Token expired',
      });
    }
    await this.users.markEmailVerified(row.userId);
    await this.evtRepo.delete({ userId: row.userId });
    await this.audit.record({
      actorUserId: row.userId,
      action: 'user.verify_email',
    });
  }

  // ---------------- Login / tokens ----------------

  async login(input: {
    email: string;
    password: string;
    ip?: string | null;
  }): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
    const email = input.email.toLowerCase();
    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.audit.record({
        action: 'user.login_failed',
        ip: input.ip ?? null,
        meta: { email },
      });
      throw new UnauthorizedException({
        error: ApiErrorCodes.INVALID_CREDENTIALS,
        message: 'Invalid credentials',
      });
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      await this.audit.record({
        actorUserId: user.id,
        action: 'user.login_failed',
        ip: input.ip ?? null,
      });
      throw new UnauthorizedException({
        error: ApiErrorCodes.INVALID_CREDENTIALS,
        message: 'Invalid credentials',
      });
    }
    if (user.disabled) {
      throw new ForbiddenException({
        error: ApiErrorCodes.ACCOUNT_DISABLED,
        message: 'Account disabled',
      });
    }
    if (this.cfg.emailVerificationRequired && !user.emailVerified) {
      throw new ForbiddenException({
        error: ApiErrorCodes.EMAIL_NOT_VERIFIED,
        message: 'Email not verified',
      });
    }

    if (needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(user.id, await hashPassword(input.password));
    }

    const tokens = await this.issueTokenPair(user.id, user.email, user.role, user.emailVerified);

    await this.audit.record({
      actorUserId: user.id,
      action: 'user.login',
      ip: input.ip ?? null,
    });

    return { user: this.users.toPublic(user), tokens };
  }

  private async issueTokenPair(
    userId: string,
    email: string,
    role: string,
    emailVerified: boolean,
    existingFamily?: string,
  ): Promise<IssuedTokens> {
    const family = existingFamily ?? randomUUID();
    const jti = randomUUID();

    const accessPayload: AccessTokenPayload = {
      sub: userId,
      role,
      emailVerified,
      jti,
      email,
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.cfg.get('JWT_ACCESS_SECRET'),
      expiresIn: this.cfg.get('JWT_ACCESS_TTL'),
    });

    const refreshPayload: RefreshTokenPayload = {
      sub: userId,
      jti,
      fam: family,
    };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.cfg.get('JWT_REFRESH_SECRET'),
      expiresIn: this.cfg.get('JWT_REFRESH_TTL'),
    });

    // Persist the new refresh token row
    const refreshTtlMs = parseTtlMs(this.cfg.get('JWT_REFRESH_TTL')) ?? 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + refreshTtlMs);
    await this.rtRepo.insert({
      userId,
      family,
      jti,
      tokenHash: sha256(refreshToken),
      expiresAt,
    });

    return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
  }

  async refresh(refreshToken: string): Promise<IssuedTokens & { user: PublicUser }> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.cfg.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        error: ApiErrorCodes.REFRESH_INVALID,
        message: 'Invalid refresh token',
      });
    }
    const row = await this.rtRepo.findOne({ where: { jti: payload.jti } });
    if (!row) {
      // Unknown jti → revoke family if we can find it
      await this.rtRepo.update({ family: payload.fam }, { revokedAt: new Date() });
      await this.audit.record({
        actorUserId: payload.sub,
        action: 'user.refresh_reuse_detected',
      });
      throw new UnauthorizedException({
        error: ApiErrorCodes.REFRESH_INVALID,
        message: 'Refresh token not recognized',
      });
    }
    if (row.revokedAt || row.replacedByJti) {
      // Reuse of a rotated token → compromise → revoke family
      await this.rtRepo.update({ family: row.family }, { revokedAt: new Date() });
      await this.audit.record({
        actorUserId: payload.sub,
        action: 'user.refresh_reuse_detected',
      });
      throw new UnauthorizedException({
        error: ApiErrorCodes.REFRESH_INVALID,
        message: 'Refresh token reuse detected',
      });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({
        error: ApiErrorCodes.REFRESH_INVALID,
        message: 'Refresh token expired',
      });
    }
    if (sha256(refreshToken) !== row.tokenHash) {
      throw new UnauthorizedException({
        error: ApiErrorCodes.REFRESH_INVALID,
        message: 'Refresh token mismatch',
      });
    }

    const user = await this.users.requireById(payload.sub);
    if (user.disabled) {
      throw new ForbiddenException({
        error: ApiErrorCodes.ACCOUNT_DISABLED,
        message: 'Account disabled',
      });
    }

    const tokens = await this.issueTokenPair(
      user.id,
      user.email,
      user.role,
      user.emailVerified,
      row.family,
    );
    const newJti =
      (this.jwt.decode(tokens.refreshToken) as RefreshTokenPayload | null)?.jti ?? null;
    await this.rtRepo.update(row.id, {
      replacedByJti: newJti,
      revokedAt: new Date(),
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'user.refresh_rotated',
    });

    return { user: this.users.toPublic(user), ...tokens };
  }

  async logout(refreshToken: string | undefined, userId: string | undefined): Promise<void> {
    if (refreshToken) {
      try {
        const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
          secret: this.cfg.get('JWT_REFRESH_SECRET'),
        });
        await this.rtRepo.update(
          { jti: payload.jti },
          { revokedAt: new Date() },
        );
      } catch {
        /* ignore invalid refresh */
      }
    }
    if (userId) {
      await this.audit.record({ actorUserId: userId, action: 'user.logout' });
    }
  }

  // ---------------- Password reset ----------------

  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return; // no enumeration
    const token = generateRandomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.prtRepo.insert({ userId: user.id, tokenHash, expiresAt, usedAt: null });
    const resetUrl = `${this.cfg.get('APP_URL')}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail
      .sendTemplate({
        to: user.email,
        template: 'password-reset',
        data: { fullName: user.fullName, resetUrl, expiresHours: 1 },
      })
      .catch((e) => this.logger.warn(`password-reset send failed: ${(e as Error).message}`));
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = sha256(token);
    const row = await this.prtRepo.findOne({ where: { tokenHash } });
    if (!row) {
      throw new BadRequestException({
        error: ApiErrorCodes.TOKEN_INVALID,
        message: 'Invalid token',
      });
    }
    if (row.usedAt) {
      throw new BadRequestException({
        error: ApiErrorCodes.TOKEN_INVALID,
        message: 'Token already used',
      });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new GoneException({
        error: ApiErrorCodes.TOKEN_EXPIRED,
        message: 'Token expired',
      });
    }
    const passwordHash = await hashPassword(newPassword);
    await this.users.updatePasswordHash(row.userId, passwordHash);
    await this.prtRepo.update(row.id, { usedAt: new Date() });
    // Invalidate all refresh tokens for this user
    await this.rtRepo.update({ userId: row.userId }, { revokedAt: new Date() });
    await this.audit.record({
      actorUserId: row.userId,
      action: 'user.reset_password',
    });
  }
}

function parseTtlMs(ttl: string): number | null {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
