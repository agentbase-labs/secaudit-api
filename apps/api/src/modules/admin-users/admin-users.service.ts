import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiErrorCodes, UserRole } from '@cs-platform/shared';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
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
