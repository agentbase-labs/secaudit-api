import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AUDIT_ACTION_KEY } from '../decorators/audit.decorator';
import { AuditService } from '../../modules/audit/audit.service';
import type { CurrentUserData } from '../decorators/current-user.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string | undefined>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: CurrentUserData }>();
    const actorUserId = req.user?.id;
    const ip = (req.ip ?? req.socket.remoteAddress ?? null) as string | null;

    return next.handle().pipe(
      tap({
        next: (res: unknown) => {
          // Best-effort: never block response on audit errors
          void this.audit
            .record({
              actorUserId: actorUserId ?? null,
              action,
              ip,
              meta: this.extractMeta(req, res),
            })
            .catch((e) => this.logger.warn(`audit write failed: ${(e as Error).message}`));
        },
      }),
    );
  }

  private extractMeta(req: Request, res: unknown): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      method: req.method,
      path: req.originalUrl,
    };
    if (req.params && Object.keys(req.params).length > 0) {
      meta['params'] = req.params;
    }
    if (res && typeof res === 'object' && 'id' in (res as Record<string, unknown>)) {
      meta['responseId'] = (res as Record<string, unknown>)['id'];
    }
    return meta;
  }
}
