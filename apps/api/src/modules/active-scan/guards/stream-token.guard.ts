import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiErrorCodes } from '@cs-platform/shared';

import { StreamTokenService } from '../stream-token.service';

/**
 * Authenticates the SSE live-progress route (§5.3). The browser's EventSource
 * cannot attach an Authorization header, so the stream is authenticated via a
 * short-lived signed token in the `?t=` query param, minted at scan-request
 * time (or refreshed via the issue-token endpoint).
 *
 * The guard:
 *   - reads `?t=<token>`,
 *   - verifies signature + expiry + audience,
 *   - asserts the token's `sub` (jobId) matches the `:id` route param,
 *   - stashes the resolved `{ jobId, userId }` on `req.streamToken` for the
 *     controller to use.
 *
 * This guard REPLACES JwtAuthGuard on the stream route (the route is @Public()
 * so the global JWT guard does not run).
 */
@Injectable()
export class StreamTokenGuard implements CanActivate {
  constructor(private readonly streamTokens: StreamTokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { streamToken?: { jobId: string; userId: string } }>();

    const t = (req.query?.['t'] ?? '') as string;
    if (!t || typeof t !== 'string') {
      throw new UnauthorizedException({
        error: ApiErrorCodes.UNAUTHORIZED,
        message: 'Missing stream token',
      });
    }

    let payload;
    try {
      payload = this.streamTokens.verify(t);
    } catch {
      throw new UnauthorizedException({
        error: ApiErrorCodes.TOKEN_INVALID,
        message: 'Invalid or expired stream token',
      });
    }

    const routeJobId = req.params?.['id'];
    if (!routeJobId || payload.sub !== routeJobId) {
      throw new UnauthorizedException({
        error: ApiErrorCodes.TOKEN_INVALID,
        message: 'Stream token does not match this job',
      });
    }

    req.streamToken = { jobId: payload.sub, userId: payload.uid };
    return true;
  }
}
