import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlanChangeRequestStatus } from '@cs-platform/shared';

import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { PlanChangeRequest } from './entities/plan-change-request.entity';
import { PlanChangeRequestsService } from './plan-change-requests.service';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Behavioural tests for the PCR email side-effects.
 *
 * For each transition we verify:
 *   - requestChange   → fires `pcr-submitted-user` to the user AND
 *                       `pcr-submitted-admin` to the admin inbox.
 *   - approve         → fires `pcr-approved` to the user with the toPlanName
 *                       and admin notes.
 *   - reject          → fires `pcr-rejected` to the user with the reason.
 *
 * Emails are best-effort: we use `setImmediate` to flush microtasks so the
 * fire-and-forget `void this.mail.sendTemplate(...)` lands before assertions.
 */

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

interface Harness {
  service: PlanChangeRequestsService;
  mail: { sendTemplate: jest.Mock };
  pcrRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  audit: { record: jest.Mock };
  user: { id: string; email: string; fullName: string; companyName: string | null };
}

async function makeHarness(opts: {
  pcr?: Partial<PlanChangeRequest>;
  subForRequest?: { planId: string };
} = {}): Promise<Harness> {
  const user = {
    id: 'u-1',
    email: 'jane@example.com',
    fullName: 'Jane Doe',
    companyName: 'Acme Corp',
  };

  const usersService = {
    findById: jest.fn().mockResolvedValue(user),
  } as unknown as UsersService;

  const cfg = {
    get: jest.fn().mockImplementation((k: string) => {
      if (k === 'APP_URL') return 'https://app.secaudit.xyz';
      if (k === 'RESEND_ADMIN_EMAIL') return 'admin@secaudit.xyz';
      return undefined;
    }),
  } as unknown as AppConfigService;

  const mail = { sendTemplate: jest.fn().mockResolvedValue({ id: 'm-1' }) };
  const audit = { record: jest.fn() };

  // Subscription stub for requestChange path
  const subs = {
    requireActive: jest.fn().mockResolvedValue({
      planId: opts.subForRequest?.planId ?? 'starter',
      userId: user.id,
    }),
    createOrSupersedePendingPcr: jest.fn().mockResolvedValue({
      id: 'pcr-1',
      userId: user.id,
      fromPlanId: 'starter',
      toPlanId: 'pro',
      billingCycle: 'monthly',
      status: PlanChangeRequestStatus.PENDING,
      createdAt: new Date(),
    }),
    applyPlanChange: jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: user.id,
      planId: 'pro',
      billingCycle: 'monthly',
    }),
  } as unknown as SubscriptionsService;

  const plans = {
    requireById: jest.fn().mockResolvedValue({ id: 'pro', name: 'Pro' }),
  } as unknown as PlansService;

  const pcrEntity: PlanChangeRequest = {
    id: 'pcr-1',
    userId: user.id,
    fromPlanId: 'starter',
    toPlanId: 'pro',
    billingCycle: 'monthly',
    status: PlanChangeRequestStatus.PENDING,
    notes: null,
    processedAt: null,
    processedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(opts.pcr ?? {}),
  } as unknown as PlanChangeRequest;

  const pcrRepo = {
    findOne: jest.fn().mockResolvedValue(pcrEntity),
    save: jest.fn().mockImplementation(async (p: PlanChangeRequest) => p),
    createQueryBuilder: jest.fn(),
  };

  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb({ save: jest.fn() })),
  } as unknown as DataSource;

  const moduleRef = await Test.createTestingModule({
    providers: [
      PlanChangeRequestsService,
      { provide: getRepositoryToken(PlanChangeRequest), useValue: pcrRepo },
      { provide: PlansService, useValue: plans },
      { provide: SubscriptionsService, useValue: subs },
      { provide: AuditService, useValue: audit },
      { provide: DataSource, useValue: dataSource },
      { provide: UsersService, useValue: usersService },
      { provide: AppConfigService, useValue: cfg },
      { provide: MAIL_SERVICE, useValue: mail },
    ],
  }).compile();

  const service = moduleRef.get(PlanChangeRequestsService);
  return { service, mail, pcrRepo, audit, user };
}

describe('PlanChangeRequestsService — email side-effects', () => {
  it('requestChange fires pcr-submitted-user to user and pcr-submitted-admin to admin', async () => {
    const { service, mail, user } = await makeHarness();

    await service.requestChange({
      userId: user.id,
      toPlanId: 'pro',
      billingCycle: 'monthly',
    });
    await flushMicrotasks();

    const calls = mail.sendTemplate.mock.calls.map((c) => c[0]);
    const userMail = calls.find((c) => c.template === 'pcr-submitted-user');
    const adminMail = calls.find((c) => c.template === 'pcr-submitted-admin');

    expect(userMail).toBeDefined();
    expect(userMail!.to).toBe(user.email);
    expect(userMail!.data).toMatchObject({
      fullName: user.fullName,
      fromPlanName: 'Starter',
      toPlanName: 'Pro',
      billingCycle: 'monthly',
    });

    expect(adminMail).toBeDefined();
    expect(adminMail!.to).toBe('admin@secaudit.xyz');
    expect(adminMail!.data).toMatchObject({
      userEmail: user.email,
      userFullName: user.fullName,
      companyName: 'Acme Corp',
      fromPlanName: 'Starter',
      toPlanName: 'Pro',
      billingCycle: 'monthly',
      pcrId: 'pcr-1',
    });
    expect(adminMail!.replyTo).toBe(user.email);
  });

  it('approve fires pcr-approved to user with notes', async () => {
    const { service, mail, user } = await makeHarness();

    await service.approve({
      pcrId: 'pcr-1',
      adminId: 'admin-1',
      notes: 'Welcome aboard!',
      ip: null,
    });
    await flushMicrotasks();

    const approved = mail.sendTemplate.mock.calls
      .map((c) => c[0])
      .find((c) => c.template === 'pcr-approved');
    expect(approved).toBeDefined();
    expect(approved!.to).toBe(user.email);
    expect(approved!.data).toMatchObject({
      fullName: user.fullName,
      toPlanName: 'Pro',
      billingCycle: 'monthly',
      notes: 'Welcome aboard!',
    });
  });

  it('reject fires pcr-rejected to user with the rejection reason', async () => {
    const { service, mail, user } = await makeHarness();

    await service.reject({
      pcrId: 'pcr-1',
      adminId: 'admin-1',
      notes: 'Please verify business details first.',
      ip: null,
    });
    await flushMicrotasks();

    const rejected = mail.sendTemplate.mock.calls
      .map((c) => c[0])
      .find((c) => c.template === 'pcr-rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.to).toBe(user.email);
    expect(rejected!.data).toMatchObject({
      fullName: user.fullName,
      toPlanName: 'Pro',
      notes: 'Please verify business details first.',
    });
  });

  it('emails are fire-and-forget: a mail failure does not throw out of approve', async () => {
    const { service, mail } = await makeHarness();
    mail.sendTemplate.mockRejectedValueOnce(new Error('boom'));

    await expect(
      service.approve({ pcrId: 'pcr-1', adminId: 'admin-1', notes: 'hi', ip: null }),
    ).resolves.toBeDefined();
    await flushMicrotasks();
  });
});
