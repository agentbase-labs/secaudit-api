import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { ApiErrorCodes } from '@cs-platform/shared';

@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: CurrentUserData }>();
    const user = req.user;
    if (!user || !user.emailVerified) {
      throw new ForbiddenException({
        error: ApiErrorCodes.EMAIL_NOT_VERIFIED,
        message: 'Email not verified',
      });
    }
    return true;
  }
}
