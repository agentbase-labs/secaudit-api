import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
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
 * Unit tests for the three new PCR self-service methods:
 *   1. cancelChange — cancel-with-no-pending-PCR → 404
 *   2. cancelChange — cancel-with-pending-PCR → transitions to cancelled
 *   3. listForUser  — returns paginated results
 */

const USER_ID = 'user-abc';

function makePcr(overrides: Partial<PlanChangeRequest> = {}): PlanChangeRequest {
  return {
    id: 'pcr-1',
    userId: USER_ID,
    fromPlanId: 'free',
    toPlanId: 'pro',
    billingCycle: 'monthly',
    status: PlanChangeRequestStatus.PENDING,
    notes: null,
    userNotes: null,
    cancelledAt: null,
    processedAt: null,
    processedBy: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  } as PlanChangeRequest;
}

interface Harness {
  service: PlanChangeRequestsService;
  pcrRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  audit: { record: jest.Mock };
}

async function makeHarness(opts: { pendingPcr?: PlanChangeRequest | null } = {}): Promise<Harness> {
  const cfg = {
    get: jest.fn().mockImplementation((k: string) => {
      if (k === 'APP_URL') return 'https://app.secaudit.xyz';
      return undefined;
    }),
  } as unknown as AppConfigService;

  const mail = { sendTemplate: jest.fn().mockResolvedValue({ id: 'm-1' }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const users = { findById: jest.fn().mockResolvedValue(null) };

  const subs = {
    requireActive: jest.fn().mockResolvedValue({ planId: 'free', userId: USER_ID }),
    createOrSupersedePendingPcr: jest.fn().mockResolvedValue(makePcr()),
    applyPlanChange: jest.fn(),
  } as unknown as SubscriptionsService;

  const plans = {
    requireById: jest.fn().mockResolvedValue({ id: 'pro' }),
  } as unknown as PlansService;

  // Default: findOne returns pending PCR (or null when specified).
  const pendingPcr = opts.pendingPcr !== undefined ? opts.pendingPcr : makePcr();

  const pcrRepo = {
    findOne: jest.fn().mockResolvedValue(pendingPcr),
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
      { provide: UsersService, useValue: users },
      { provide: AppConfigService, useValue: cfg },
      { provide: MAIL_SERVICE, useValue: mail },
    ],
  }).compile();

  const service = moduleRef.get(PlanChangeRequestsService);
  return { service, pcrRepo, audit };
}

describe('PlanChangeRequestsService — cancelChange', () => {
  it('returns 404 when no pending PCR exists for the user', async () => {
    const { service } = await makeHarness({ pendingPcr: null });

    await expect(service.cancelChange({ userId: USER_ID })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('transitions a pending PCR to cancelled and records audit', async () => {
    const pcr = makePcr({ status: PlanChangeRequestStatus.PENDING });
    const { service, pcrRepo, audit } = await makeHarness({ pendingPcr: pcr });

    const result = await service.cancelChange({ userId: USER_ID });

    // Status should be updated on the entity before save.
    expect(pcrRepo.save).toHaveBeenCalledTimes(1);
    const savedArg = pcrRepo.save.mock.calls[0][0] as PlanChangeRequest;
    expect(savedArg.status).toBe(PlanChangeRequestStatus.CANCELLED);
    expect(savedArg.cancelledAt).toBeInstanceOf(Date);

    // Response shape.
    expect(result.success).toBe(true);
    expect(result.cancelledAt).toBeInstanceOf(Date);

    // Audit trail.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: USER_ID,
        action: 'subscription.change_cancelled',
        targetType: 'PlanChangeRequest',
        targetId: 'pcr-1',
      }),
    );
  });
});

describe('PlanChangeRequestsService — listForUser', () => {
  it('returns paginated results in newest-first order', async () => {
    const pcr1 = makePcr({ id: 'pcr-1', createdAt: new Date('2026-01-02T00:00:00Z') });
    const pcr2 = makePcr({
      id: 'pcr-2',
      status: PlanChangeRequestStatus.APPROVED,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      processedAt: new Date('2026-01-01T12:00:00Z'),
      processedBy: 'admin-uuid',
      notes: 'Approved — payment verified',
    });

    const { service, pcrRepo } = await makeHarness({ pendingPcr: null });

    // Mock query builder chain.
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[pcr1, pcr2], 2]),
    };
    pcrRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.listForUser({ userId: USER_ID, page: 1, pageSize: 10 });

    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.items).toHaveLength(2);

    // First item (pending pcr1).
    expect(result.items[0]).toMatchObject({
      id: 'pcr-1',
      toPlanId: 'pro',
      toBillingCycle: 'monthly',
      status: PlanChangeRequestStatus.PENDING,
      userNotes: null,
      adminNotes: null,
    });

    // Second item (approved pcr2).
    expect(result.items[1]).toMatchObject({
      id: 'pcr-2',
      status: PlanChangeRequestStatus.APPROVED,
      adminNotes: 'Approved — payment verified',
      processedBy: 'admin-uuid',
    });
    expect(typeof result.items[1].processedAt).toBe('string');
  });

  it('clamps pageSize to max 50', async () => {
    const { service, pcrRepo } = await makeHarness({ pendingPcr: null });
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    pcrRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.listForUser({ userId: USER_ID, pageSize: 999 });

    expect(result.pageSize).toBe(50);
    expect(qb.take).toHaveBeenCalledWith(50);
  });
});
