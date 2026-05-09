import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface CurrentUserData {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
  jti?: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext): unknown => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: CurrentUserData }>();
    const user = req.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
