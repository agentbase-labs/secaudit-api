import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditRecord {
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  async record(input: AuditRecord): Promise<void> {
    try {
      const entity = this.repo.create({
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ip: input.ip ?? null,
        meta: (input.meta ?? {}) as Record<string, unknown>,
      });
      await this.repo.save(entity);
    } catch (e) {
      this.logger.warn(`audit.record failed (${input.action}): ${(e as Error).message}`);
    }
  }

  async list(filters: {
    actorUserId?: string;
    targetType?: string;
    targetId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const qb = this.repo
      .createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (filters.actorUserId) qb.andWhere('a.actorUserId = :aid', { aid: filters.actorUserId });
    if (filters.targetType) qb.andWhere('a.targetType = :tt', { tt: filters.targetType });
    if (filters.targetId) qb.andWhere('a.targetId = :tid', { tid: filters.targetId });
    if (filters.action) qb.andWhere('a.action = :act', { act: filters.action });
    if (filters.from) qb.andWhere('a.createdAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('a.createdAt <= :to', { to: filters.to });
    const [items, total] = await qb.getManyAndCount();
    return { items, page, pageSize, total };
  }

  async cleanupOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const res = await this.repo.delete({ createdAt: LessThan(cutoff) });
    return res.affected ?? 0;
  }
}
