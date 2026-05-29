import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ApiErrorCodes,
  SubscriptionStatus,
  UserRole,
} from '@cs-platform/shared';
import type {
  AdminUserAuditEvent,
  AdminUserDetailResponse,
  AdminUserPlanChangeRequest,
  AdminUserRequestSummary,
  AdminUserSubscriptionSummary,
  BillingCycle,
  PlanChangeRequestStatus,
  PlanSlug,
} from '@cs-platform/shared';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { Subscription } from '../plans/entities/subscription.entity';
import { PlanChangeRequest } from '../plans/entities/plan-change-request.entity';
import { TestingRequest } from '../requests/entities/testing-request.entity';
import { Report } from '../reports/entities/report.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subsRepo: Repository<Subscription>,
    @InjectRepository(PlanChangeRequest)
    private readonly pcrRepo: Repository<PlanChangeRequest>,
    @InjectRepository(TestingRequest)
    private readonly requestRepo: Repository<TestingRequest>,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async list(q: {
    search?: string;
    role?: UserRole;
    disabled?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
    const qb = this.repo
      .createQueryBuilder('u')
      .orderBy('u.createdAt', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize);
    if (q.search) qb.andWhere('u.email ILIKE :s', { s: `%${q.search}%` });
    if (q.role) qb.andWhere('u.role = :r', { r: q.role });
    if (q.disabled !== undefined) qb.andWhere('u.disabled = :d', { d: q.disabled });
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((u) => this.users.toPublic(u)),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Full per-user detail payload for the admin user-detail page.
   * Assembles core user fields, current subscription, plan-change requests,
   * scan/audit (testing) requests + report flags, and recent audit-log events.
   * Throws 404 if the user does not exist.
   */
  async getDetail(id: string): Promise<AdminUserDetailResponse> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException({
        error: ApiErrorCodes.NOT_FOUND,
        message: 'User not found',
      });
    }

    // ---- Current subscription (prefer the active one, else most recent) ----
    const subs = await this.subsRepo.find({
      where: { userId: id },
      order: { startedAt: 'DESC' },
    });
    const activeSub =
      subs.find((s) => s.status === SubscriptionStatus.ACTIVE) ?? subs[0] ?? null;
    const subscription: AdminUserSubscriptionSummary | null = activeSub
      ? {
          id: activeSub.id,
          planId: activeSub.planId as PlanSlug,
          status: activeSub.status,
          billingCycle: activeSub.billingCycle as BillingCycle | null,
          startedAt: activeSub.startedAt.toISOString(),
          currentPeriodEnd: activeSub.currentPeriodEnd?.toISOString() ?? null,
          requestedPlanId: (activeSub.requestedPlanId as PlanSlug | null) ?? null,
        }
      : null;

    // ---- Plan-change requests (latest first, all history) ----
    const pcrRows = await this.pcrRepo.find({
      where: { userId: id },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const planChangeRequests: AdminUserPlanChangeRequest[] = pcrRows.map((p) => ({
      id: p.id,
      fromPlanId: p.fromPlanId as PlanSlug,
      toPlanId: p.toPlanId as PlanSlug,
      status: p.status as PlanChangeRequestStatus,
      billingCycle: p.billingCycle,
      createdAt: p.createdAt.toISOString(),
      processedAt: p.processedAt?.toISOString() ?? null,
      notes: p.notes,
    }));

    // ---- Scan/audit (testing) requests + report flags (latest ~50) ----
    const requestRows = await this.requestRepo.find({
      where: { userId: id },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    let reportRequestIds = new Set<string>();
    if (requestRows.length > 0) {
      const reports = await this.reportRepo.find({
        where: { requestId: In(requestRows.map((r) => r.id)) },
        select: { id: true, requestId: true },
      });
      reportRequestIds = new Set(reports.map((r) => r.requestId));
    }
    const requests: AdminUserRequestSummary[] = requestRows.map((r) => ({
      id: r.id,
      assetType: r.assetType,
      testingType: r.testingType,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      hasReport: reportRequestIds.has(r.id),
    }));

    // ---- Recent audit-log events for/by the user (latest ~50) ----
    const auditRows = await this.auditRepo.find({
      where: { actorUserId: id },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const auditEvents: AdminUserAuditEvent[] = auditRows.map((a) => ({
      id: a.id,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      ip: a.ip,
      meta: a.meta,
      createdAt: a.createdAt.toISOString(),
    }));

    return {
      user: this.users.toPublic(user),
      subscription,
      planChangeRequests,
      requests,
      auditEvents,
    };
  }

  async update(
    actorId: string,
    targetId: string,
    patch: { role?: UserRole; disabled?: boolean },
    ip: string | null,
  ) {
    if (patch.role === undefined && patch.disabled === undefined) {
      throw new BadRequestException({
        error: ApiErrorCodes.EMPTY_BODY,
        message: 'Provide role or disabled',
      });
    }
    if (actorId === targetId) {
      throw new UnprocessableEntityException({
        error: ApiErrorCodes.SELF_MODIFY_FORBIDDEN,
        message: 'Admins cannot modify their own role/disabled state',
      });
    }
    const user = await this.users.findById(targetId);
    if (!user) {
      throw new NotFoundException({ error: ApiErrorCodes.NOT_FOUND, message: 'User not found' });
    }
    const updates: Partial<User> = {};
    if (patch.role !== undefined) updates.role = patch.role;
    if (patch.disabled !== undefined) updates.disabled = patch.disabled;
    await this.repo.update(targetId, updates);
    await this.audit.record({
      actorUserId: actorId,
      action: 'admin.user_update',
      targetType: 'User',
      targetId,
      ip,
      meta: updates,
    });
    const fresh = await this.users.requireById(targetId);
    return this.users.toPublic(fresh);
  }
}
