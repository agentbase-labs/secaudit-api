import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PlanChangeRequestStatus, SubscriptionStatus } from '@cs-platform/shared';

import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../plans/subscriptions.service';
import { Subscription } from '../plans/entities/subscription.entity';
import { PlanChangeRequest } from '../plans/entities/plan-change-request.entity';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';

/**
 * Behavioural tests for the new register flow paths.
 *
 *   - planId='pro'        -> User created, Subscription on 'free' (NOT pro),
 *                            PlanChangeRequest pending fromPlan='free' toPlan='pro'.
 *   - planId='enterprise' -> 400 with the canonical contact-sales message.
 *   - planId omitted      -> Original behaviour (Free sub created, no PCR).
 */

interface SavedRows {
  users: User[];
  subscriptions: Subscription[];
  pcrs: PlanChangeRequest[];
}

function buildHarness(opts: { emailVerificationRequired?: boolean } = {}) {
  const saved: SavedRows = { users: [], subscriptions: [], pcrs: [] };

  // Minimal in-memory EntityManager for the transaction callback.
  const em = {
    create: jest.fn().mockImplementation((entity: unknown, payload: object) => {
      const obj = { ...(payload as object) } as Record<string, unknown>;
      // Tag the entity type for save() routing.
      Object.defineProperty(obj, '__entity', {
        value: (entity as { name: string }).name,
        enumerable: false,
      });
      return obj;
    }),
    save: jest.fn().mockImplementation(async (e: Record<string, unknown>) => {
      const tag = (e as { __entity?: string }).__entity;
      const out = { ...e } as Record<string, unknown>;
      if (!out.id) out.id = `id-${Math.random().toString(36).slice(2, 10)}`;
      if (tag === 'User') {
        out.createdAt = new Date();
        out.updatedAt = new Date();
        saved.users.push(out as unknown as User);
      } else if (tag === 'Subscription') {
        saved.subscriptions.push(out as unknown as Subscription);
      } else if (tag === 'PlanChangeRequest') {
        if (!out.createdAt) out.createdAt = new Date();
        saved.pcrs.push(out as unknown as PlanChangeRequest);
      }
      return out;
    }),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    }),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: jest.fn(async (cb: (m: EntityManager) => unknown) => cb(em)),
  } as unknown as DataSource;

  const usersService = {
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    toPublic: jest
      .fn()
      .mockImplementation((u: User) => ({ id: u.id, email: u.email, fullName: u.fullName })),
  } as unknown as UsersService;

  const cfg = {
    emailVerificationRequired: opts.emailVerificationRequired ?? false,
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return 'a'.repeat(64);
      if (key === 'JWT_REFRESH_SECRET') return 'b'.repeat(64);
      if (key === 'JWT_ACCESS_TTL') return '15m';
      if (key === 'JWT_REFRESH_TTL') return '7d';
      if (key === 'CONTACT_INBOX_EMAIL') return 'ops@example.com';
      if (key === 'APP_URL') return 'http://localhost:3000';
      return undefined;
    }),
  } as unknown as AppConfigService;

  const audit = { record: jest.fn() } as unknown as AuditService;
  const mail = { sendTemplate: jest.fn().mockResolvedValue({ id: 'm1' }) };

  const subscriptions = new SubscriptionsService(
    {
      manager: { transaction: dataSource.transaction },
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof getRepositoryToken> as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // Real createInitialFreeInTx + createOrSupersedePendingPcr — they call em.create/save.

  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
    decode: jest.fn().mockReturnValue({ jti: 'x' }),
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  // Per-token repos used by AuthService for verification/refresh/etc — not exercised here.
  const evtRepo = { insert: jest.fn() } as unknown;
  const prtRepo = { insert: jest.fn() } as unknown;
  const rtRepo = { insert: jest.fn() } as unknown;

  const authService = new AuthService(
    usersService,
    jwt,
    cfg,
    audit,
    subscriptions,
    dataSource,
    mail as unknown as never,
    evtRepo as never,
    prtRepo as never,
    rtRepo as never,
  );

  return { authService, saved, mail, audit, cfg, em };
}

describe('AuthService.register — plan selection paths', () => {
  it('rejects planId=enterprise with 400 + sales-contact message', async () => {
    const { authService } = buildHarness();
    await expect(
      authService.register({
        fullName: 'Eve Enterprise',
        email: 'eve@example.com',
        password: 'CorrectHorseBattery1!',
        planId: 'enterprise',
        billingCycle: 'monthly',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('register without planId behaves identically (Free sub, no PCR)', async () => {
    const { authService, saved } = buildHarness();
    const result = await authService.register({
      fullName: 'No Plan',
      email: 'noplan@example.com',
      password: 'CorrectHorseBattery1!',
    });
    if (!result.autoLogin) throw new Error('expected autoLogin');
    expect(result.pendingUpgrade).toBe(false);
    expect(result.pendingPlan).toBeNull();
    expect(saved.users).toHaveLength(1);
    expect(saved.subscriptions).toHaveLength(1);
    expect(saved.subscriptions[0]!.planId).toBe('free');
    expect(saved.subscriptions[0]!.status).toBe(SubscriptionStatus.ACTIVE);
    expect(saved.pcrs).toHaveLength(0);
  });

  it('register with planId=pro creates Free sub AND a pending PCR', async () => {
    const { authService, saved } = buildHarness();
    const result = await authService.register({
      fullName: 'Pat Pro',
      email: 'pro@example.com',
      password: 'CorrectHorseBattery1!',
      planId: 'pro',
      billingCycle: 'monthly',
    });
    if (!result.autoLogin) throw new Error('expected autoLogin');
    expect(result.pendingUpgrade).toBe(true);
    expect(result.pendingPlan).toBe('pro');
    expect(saved.subscriptions).toHaveLength(1);
    expect(saved.subscriptions[0]!.planId).toBe('free');
    expect(saved.pcrs).toHaveLength(1);
    expect(saved.pcrs[0]!.fromPlanId).toBe('free');
    expect(saved.pcrs[0]!.toPlanId).toBe('pro');
    expect(saved.pcrs[0]!.billingCycle).toBe('monthly');
    expect(saved.pcrs[0]!.status).toBe(PlanChangeRequestStatus.PENDING);
  });

  it('register with planId=pro defaults billingCycle=monthly when omitted', async () => {
    const { authService, saved } = buildHarness();
    await authService.register({
      fullName: 'P P',
      email: 'pp@example.com',
      password: 'CorrectHorseBattery1!',
      planId: 'pro',
    });
    expect(saved.pcrs[0]!.billingCycle).toBe('monthly');
  });

  it('free signup fires welcome-signup email with planName=Free, pendingUpgrade=false', async () => {
    const { authService, mail } = buildHarness();
    await authService.register({
      fullName: 'Welcome User',
      email: 'welcome@example.com',
      password: 'CorrectHorseBattery1!',
    });
    // Flush fire-and-forget microtasks.
    await new Promise((r) => setImmediate(r));
    const welcome = mail.sendTemplate.mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .find((c) => c.template === 'welcome-signup');
    expect(welcome).toBeDefined();
    expect(welcome!.to).toBe('welcome@example.com');
    expect(welcome!.data).toMatchObject({
      fullName: 'Welcome User',
      planName: 'Free',
      pendingUpgrade: false,
    });
  });

  it('paid signup fires welcome-signup with pendingUpgrade=true and pendingPlanName=Pro', async () => {
    const { authService, mail } = buildHarness();
    await authService.register({
      fullName: 'Pending Pro',
      email: 'pending@example.com',
      password: 'CorrectHorseBattery1!',
      planId: 'pro',
      billingCycle: 'monthly',
    });
    await new Promise((r) => setImmediate(r));
    const welcome = mail.sendTemplate.mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .find((c) => c.template === 'welcome-signup');
    expect(welcome).toBeDefined();
    expect(welcome!.data).toMatchObject({
      fullName: 'Pending Pro',
      planName: 'Free',
      pendingUpgrade: true,
      pendingPlanName: 'Pro',
    });
  });
});
