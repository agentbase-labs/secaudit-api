import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ApiErrorCodes, UserRole } from '@cs-platform/shared';
import type { Request } from 'express';
import type { CurrentUserData } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: CurrentUserData }>();
    const user = req.user;
    if (!user || !required.includes(user.role as UserRole)) {
      throw new ForbiddenException({
        error: ApiErrorCodes.FORBIDDEN,
        message: 'Insufficient role',
      });
    }
    return true;
  }
}
