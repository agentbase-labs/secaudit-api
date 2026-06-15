import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { ApiErrorCodes } from '@cs-platform/shared';

import { AppConfigService } from '../../../config/config.service';

/**
 * Authenticates the internal worker→backend endpoints via the
 * `X-Worker-Secret` header, constant-time compared against
 * `ACTIVE_SCAN_WORKER_SECRET` (ACTIVE_SCAN_DESIGN.md §5.2 / §10).
 *
 * Fail-closed: if the env secret is unset/empty, ALL requests are rejected
 * (so a misconfigured deploy never accidentally accepts unauthenticated
 * worker calls). NOT behind JwtAuthGuard — this guard fully replaces it for
 * the internal controller, which is also marked @Public() so the global JWT
 * guard does not run first.
 */
@Injectable()
export class WorkerSecretGuard implements CanActivate {
  constructor(private readonly cfg: AppConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.cfg.activeScanWorkerSecret;
    if (!expected) {
      throw new UnauthorizedException({
        error: ApiErrorCodes.UNAUTHORIZED,
        message: 'Worker endpoint disabled (no shared secret configured)',
      });
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers['x-worker-secret'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !constantTimeEquals(provided, expected)) {
      throw new UnauthorizedException({
        error: ApiErrorCodes.UNAUTHORIZED,
        message: 'Invalid worker secret',
      });
    }
    return true;
  }
}

/** Length-safe constant-time string compare. */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch — hash both to a fixed length
  // first so we don't leak length via an early return.
  const ah = crypto.createHash('sha256').update(ab).digest();
  const bh = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}
