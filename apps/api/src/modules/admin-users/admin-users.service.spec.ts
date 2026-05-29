import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AssetType,
  PlanChangeRequestStatus,
  RequestStatus,
  SubscriptionStatus,
  TestingType,
  UserRole,
} from '@cs-platform/shared';

import { AdminUsersService } from './admin-users.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { Subscription } from '../plans/entities/subscription.entity';
import { PlanChangeRequest } from '../plans/entities/plan-change-request.entity';
import { TestingRequest } from '../requests/entities/testing-request.entity';
import { Report } from '../reports/entities/report.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

/**
 * Spec for AdminUsersService.getDetail — assembles the full per-user payload
 * for the admin detail page. Covers the happy path and the 404 (user missing).
 */

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makeUser(): User {
  return {
    id: USER_ID,
    fullName: 'Dana Detail',
    email: 'dana@example.com',
    companyName: 'Acme Corp',
    passwordHash: 'x',
    role: UserRole.CLIENT,
    emailVerified: true,
    disabled: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-02-01T00:00:00Z'),
  } as User;
}

async function buildSubject(opts: { userExists: boolean }) {
  const user = makeUser();

  const usersService = {
    findById: jest.fn().mockResolvedValue(opts.userExists ? user : null),
    toPublic: jest.fn().mockImplementation((u: User) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      companyName: u.companyName,
      role: u.role,
      emailVerified: u.emailVerified,
      disabled: u.disabled,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
  } as unknown as UsersService;

  const subsRepo: Partial<Repository<Subscription>> = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'sub-1',
        userId: USER_ID,
        planId: 'starter',
        status: SubscriptionStatus.PENDING_UPGRADE,
        billingCycle: null,
        startedAt: new Date('2024-01-01T00:00:00Z'),
        currentPeriodEnd: null,
        requestedPlanId: null,
      } as unknown as Subscription,
    ]),
  };

  const pcrRepo: Partial<Repository<PlanChangeRequest>> = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'pcr-1',
        userId: USER_ID,
        fromPlanId: 'starter',
        toPlanId: 'pro',
        status: PlanChangeRequestStatus.PENDING,
        billingCycle: 'monthly',
        createdAt: new Date('2024-01-02T00:00:00Z'),
        processedAt: null,
        notes: null,
      } as unknown as PlanChangeRequest,
    ]),
  };

  const requestRows = [
    {
      id: 'req-1',
      userId: USER_ID,
      assetType: AssetType.WEBSITE,
      testingType: TestingType.VULN_SCAN,
      status: RequestStatus.SUBMITTED,
      createdAt: new Date('2024-01-03T00:00:00Z'),
    } as unknown as TestingRequest,
  ];
  const requestRepo: Partial<Repository<TestingRequest>> = {
    find: jest.fn().mockResolvedValue(requestRows),
  };

  const reportRepo: Partial<Repository<Report>> = {
    find: jest.fn().mockResolvedValue([{ id: 'rep-1', requestId: 'req-1' }]),
  };

  const auditRepo: Partial<Repository<AuditLog>> = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'audit-1',
        actorUserId: USER_ID,
        action: 'user.login',
        targetType: null,
        targetId: null,
        ip: null,
        meta: {},
        createdAt: new Date('2024-01-04T00:00:00Z'),
      } as unknown as AuditLog,
    ]),
  };

  const audit = { record: jest.fn() } as unknown as AuditService;

  const moduleRef = await Test.createTestingModule({
    providers: [
      AdminUsersService,
      { provide: getRepositoryToken(User), useValue: {} },
      { provide: getRepositoryToken(Subscription), useValue: subsRepo },
      { provide: getRepositoryToken(PlanChangeRequest), useValue: pcrRepo },
      { provide: getRepositoryToken(TestingRequest), useValue: requestRepo },
      { provide: getRepositoryToken(Report), useValue: reportRepo },
      { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
      { provide: UsersService, useValue: usersService },
      { provide: AuditService, useValue: audit },
    ],
  }).compile();

  return { service: moduleRef.get(AdminUsersService), usersService };
}

describe('AdminUsersService.getDetail', () => {
  it('assembles the full payload for an existing user', async () => {
    const { service } = await buildSubject({ userExists: true });
    const detail = await service.getDetail(USER_ID);

    expect(detail.user.id).toBe(USER_ID);
    expect(detail.user.email).toBe('dana@example.com');

    expect(detail.subscription).not.toBeNull();
    expect(detail.subscription!.planId).toBe('starter');
    expect(detail.subscription!.status).toBe(SubscriptionStatus.PENDING_UPGRADE);

    expect(detail.planChangeRequests).toHaveLength(1);
    expect(detail.planChangeRequests[0]!.toPlanId).toBe('pro');
    expect(detail.planChangeRequests[0]!.status).toBe(PlanChangeRequestStatus.PENDING);

    expect(detail.requests).toHaveLength(1);
    expect(detail.requests[0]!.id).toBe('req-1');
    expect(detail.requests[0]!.hasReport).toBe(true);

    expect(detail.auditEvents).toHaveLength(1);
    expect(detail.auditEvents[0]!.action).toBe('user.login');
  });

  it('throws NotFound when the user does not exist', async () => {
    const { service } = await buildSubject({ userExists: false });
    await expect(service.getDetail(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
