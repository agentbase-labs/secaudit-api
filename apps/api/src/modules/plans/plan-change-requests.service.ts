import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ApiErrorCodes,
  PlanChangeRequestStatus,
} from '@cs-platform/shared';
import type { BillingCycle, PlanSlug } from '@cs-platform/shared';

import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import type { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { PlanChangeRequest } from './entities/plan-change-request.entity';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class PlanChangeRequestsService {
  private readonly logger = new Logger(PlanChangeRequestsService.name);

  constructor(
    @InjectRepository(PlanChangeRequest)
    private readonly repo: Repository<PlanChangeRequest>,
    private readonly plans: PlansService,
    private readonly subs: SubscriptionsService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly cfg: AppConfigService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
  ) {}

  // ---------------- Email helpers ----------------

  private prettyPlanName(slug: string): string {
    switch (slug) {
      case 'starter':
        return 'Starter';
      case 'pro':
        return 'Pro';
      case 'business':
        return 'Business';
      case 'enterprise':
        return 'Enterprise';
      default:
        return slug.charAt(0).toUpperCase() + slug.slice(1);
    }
  }

  private appUrl(): string {
    return this.cfg.get('APP_URL');
  }

  private adminInboxAddress(): string {
    // RESEND_ADMIN_EMAIL > CONTACT_INBOX_EMAIL > ADMIN_EMAIL > admin@secaudit.xyz
    // Read both via cfg + raw env to handle either being set in prod.
    const cfgGet = (k: string): string => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return ((this.cfg as any).get(k) ?? '').toString().trim();
      } catch {
        return '';
      }
    };
    return (
      cfgGet('RESEND_ADMIN_EMAIL') ||
      (process.env.RESEND_ADMIN_EMAIL ?? '').trim() ||
      cfgGet('CONTACT_INBOX_EMAIL') ||
      cfgGet('ADMIN_EMAIL') ||
      (process.env.ADMIN_EMAIL ?? '').trim() ||
      'admin@secaudit.xyz'
    );
  }

  private fireEmail(p: Promise<unknown>, label: string): void {
    void p.catch((e) =>
      this.logger.warn(`mail:${label} send failed: ${(e as Error).message}`),
    );
  }

  /** User-driven plan change request (creates pending PCR). */
  async requestChange(args: {
    userId: string;
    toPlanId: string;
    billingCycle: BillingCycle;
    userNotes?: string | null;
  }): Promise<PlanChangeRequest> {
    const sub = await this.subs.requireActive(args.userId);

    // Reject identity changes.
    if (args.toPlanId === sub.planId) {
      throw new ConflictException({
        error: 'already_on_plan',
        message: `You are already on ${sub.planId}`,
      });
    }

    // Plan must exist.
    await this.plans.requireById(args.toPlanId);

    // Enterprise self-serve: behaviour TBD (sales call). For now allow PCR
    // creation; ops will pick it up. Doc \u00a73.4 says "we'll be in touch".
    const pcr = await this.subs.createOrSupersedePendingPcr({
      userId: args.userId,
      fromPlanId: sub.planId,
      toPlanId: args.toPlanId,
      billingCycle: args.billingCycle,
    });

    // Persist user-supplied context note (separate from admin decision notes).
    if (args.userNotes) {
      pcr.userNotes = args.userNotes.trim().slice(0, 500);
      await this.repo.save(pcr);
    }

    await this.audit.record({
      actorUserId: args.userId,
      action: 'subscription.change_requested',
      targetType: 'PlanChangeRequest',
      targetId: pcr.id,
      meta: { fromPlanId: pcr.fromPlanId, toPlanId: pcr.toPlanId, billingCycle: pcr.billingCycle },
    });

    // Fire-and-forget: confirm to user + notify admin inbox.
    const fromPlanName = this.prettyPlanName(pcr.fromPlanId);
    const toPlanName = this.prettyPlanName(pcr.toPlanId);
    const dashboardUrl = `${this.appUrl()}/dashboard/billing`;
    const adminInboxUrl = `${this.appUrl()}/admin/plan-change-requests`;

    const user = await this.users.findById(args.userId).catch(() => null);
    if (user) {
      this.fireEmail(
        this.mail.sendTemplate({
          to: user.email,
          template: 'pcr-submitted-user',
          data: {
            fullName: user.fullName,
            fromPlanName,
            toPlanName,
            billingCycle: pcr.billingCycle,
            dashboardUrl,
          },
        }),
        'pcr-submitted-user',
      );
      this.fireEmail(
        this.mail.sendTemplate({
          to: this.adminInboxAddress(),
          template: 'pcr-submitted-admin',
          data: {
            userEmail: user.email,
            userFullName: user.fullName,
            companyName: user.companyName ?? undefined,
            fromPlanName,
            toPlanName,
            billingCycle: pcr.billingCycle,
            pcrId: pcr.id,
            adminInboxUrl,
          },
          replyTo: user.email,
        }),
        'pcr-submitted-admin',
      );
    }

    return pcr;
  }

  // ---------------- User self-service ----------------

  /**
   * Cancel the authenticated user's own **pending** PCR.
   * Returns 404 if no pending PCR exists.
   */
  async cancelChange(args: { userId: string }): Promise<{ success: true; cancelledAt: Date }> {
    const pcr = await this.repo.findOne({
      where: { userId: args.userId, status: PlanChangeRequestStatus.PENDING },
    });
    if (!pcr) {
      throw new NotFoundException({
        code: 'NO_PENDING_REQUEST',
        message: 'No pending plan change request found',
      });
    }
    pcr.status = PlanChangeRequestStatus.CANCELLED;
    pcr.cancelledAt = new Date();
    await this.repo.save(pcr);

    await this.audit.record({
      actorUserId: args.userId,
      action: 'subscription.change_cancelled',
      targetType: 'PlanChangeRequest',
      targetId: pcr.id,
      meta: { toPlanId: pcr.toPlanId },
    });

    return { success: true, cancelledAt: pcr.cancelledAt };
  }

  /**
   * List the authenticated user's own PCR history (paginated, newest first).
   */
  async listForUser(args: {
    userId: string;
    status?: PlanChangeRequestStatus;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, args.pageSize ?? 10));
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.userId = :uid', { uid: args.userId })
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (args.status) qb.andWhere('p.status = :s', { s: args.status });
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((r) => ({
        id: r.id,
        toPlanId: r.toPlanId as PlanSlug,
        toBillingCycle: r.billingCycle,
        status: r.status,
        userNotes: r.userNotes,
        adminNotes: r.notes,
        createdAt: r.createdAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
        processedBy: r.processedBy,
      })),
      total,
      page,
      pageSize,
    };
  }

  // ---------------- Admin ----------------

  async list(filters: {
    status?: PlanChangeRequestStatus;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const qb = this.repo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'u')
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (filters.status) qb.andWhere('p.status = :s', { s: filters.status });
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((r) => ({
        id: r.id,
        user: r.user
          ? {
              id: r.user.id,
              email: r.user.email,
              fullName: r.user.fullName,
              companyName: r.user.companyName,
            }
          : null,
        fromPlanId: r.fromPlanId as PlanSlug,
        toPlanId: r.toPlanId as PlanSlug,
        billingCycle: r.billingCycle,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
        processedBy: r.processedBy,
        notes: r.notes,
        adminNotes: r.notes,
        userNotes: r.userNotes,
      })),
      page,
      pageSize,
      total,
    };
  }

  async approve(args: {
    pcrId: string;
    adminId: string;
    notes?: string;
    ip?: string | null;
  }) {
    const pcr = await this.repo.findOne({ where: { id: args.pcrId } });
    if (!pcr) {
      throw new NotFoundException({
        error: ApiErrorCodes.NOT_FOUND,
        message: 'Plan change request not found',
      });
    }
    if (pcr.status !== PlanChangeRequestStatus.PENDING) {
      throw new ConflictException({
        error: 'pcr_not_pending',
        message: `Request is ${pcr.status}, cannot approve`,
      });
    }

    const updatedSub = await this.dataSource.transaction(async (m) => {
      const sub = await this.subs.applyPlanChange(
        m,
        pcr.userId,
        pcr.toPlanId,
        pcr.billingCycle,
      );
      pcr.status = PlanChangeRequestStatus.APPROVED;
      pcr.processedAt = new Date();
      pcr.processedBy = args.adminId;
      pcr.notes = args.notes ?? pcr.notes;
      await m.save(pcr);
      return sub;
    });

    await this.audit.record({
      actorUserId: args.adminId,
      action: 'subscription.upgraded',
      targetType: 'Subscription',
      targetId: updatedSub.id,
      ip: args.ip ?? null,
      meta: {
        pcrId: pcr.id,
        userId: pcr.userId,
        fromPlanId: pcr.fromPlanId,
        toPlanId: pcr.toPlanId,
        billingCycle: pcr.billingCycle,
      },
    });

    // Fire-and-forget: tell the user their upgrade is now active.
    const userForApprove = await this.users.findById(pcr.userId).catch(() => null);
    if (userForApprove) {
      this.fireEmail(
        this.mail.sendTemplate({
          to: userForApprove.email,
          template: 'pcr-approved',
          data: {
            fullName: userForApprove.fullName,
            toPlanName: this.prettyPlanName(pcr.toPlanId),
            billingCycle: pcr.billingCycle,
            notes: args.notes,
            dashboardUrl: `${this.appUrl()}/dashboard/billing`,
          },
        }),
        'pcr-approved',
      );
    }

    return { pcr, subscription: updatedSub };
  }

  async reject(args: {
    pcrId: string;
    adminId: string;
    notes: string;
    ip?: string | null;
  }) {
    if (!args.notes || args.notes.length < 5) {
      throw new BadRequestException({
        error: ApiErrorCodes.VALIDATION_ERROR,
        message: 'Reject reason (notes) is required (5\u20131000 chars).',
      });
    }
    const pcr = await this.repo.findOne({ where: { id: args.pcrId } });
    if (!pcr) {
      throw new NotFoundException({
        error: ApiErrorCodes.NOT_FOUND,
        message: 'Plan change request not found',
      });
    }
    if (pcr.status !== PlanChangeRequestStatus.PENDING) {
      throw new ConflictException({
        error: 'pcr_not_pending',
        message: `Request is ${pcr.status}, cannot reject`,
      });
    }
    pcr.status = PlanChangeRequestStatus.REJECTED;
    pcr.processedAt = new Date();
    pcr.processedBy = args.adminId;
    pcr.notes = args.notes;
    await this.repo.save(pcr);

    await this.audit.record({
      actorUserId: args.adminId,
      action: 'subscription.change_rejected',
      targetType: 'PlanChangeRequest',
      targetId: pcr.id,
      ip: args.ip ?? null,
      meta: { userId: pcr.userId, toPlanId: pcr.toPlanId, notes: pcr.notes },
    });

    // Fire-and-forget: explain the rejection.
    const userForReject = await this.users.findById(pcr.userId).catch(() => null);
    if (userForReject) {
      this.fireEmail(
        this.mail.sendTemplate({
          to: userForReject.email,
          template: 'pcr-rejected',
          data: {
            fullName: userForReject.fullName,
            toPlanName: this.prettyPlanName(pcr.toPlanId),
            notes: args.notes,
            dashboardUrl: `${this.appUrl()}/dashboard/billing`,
          },
        }),
        'pcr-rejected',
      );
    }

    return pcr;
  }
}
