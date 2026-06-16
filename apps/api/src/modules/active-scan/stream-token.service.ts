import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/config.service';

const STREAM_AUDIENCE = 'active-scan-stream';

export interface StreamTokenPayload {
  sub: string; // jobId
  uid: string; // owning userId (so the SSE route can authorize)
  aud: string; // STREAM_AUDIENCE
  iat?: number;
  exp?: number;
}

/**
 * Mints + verifies the short-lived signed stream tokens used to authenticate
 * the SSE route (EventSource cannot send an Authorization header — §5.3).
 *
 * Token: signed JWT, aud=`active-scan-stream`, sub=jobId, uid=userId,
 * exp=`SCAN_STREAM_TOKEN_TTL_SEC` (default 600s). Signed with
 * `SCAN_STREAM_TOKEN_SECRET` (falls back to JWT_ACCESS_SECRET).
 */
@Injectable()
export class StreamTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
  ) {}

  get ttlSec(): number {
    return this.cfg.streamTokenTtlSec;
  }

  sign(jobId: string, userId: string): string {
    return this.jwt.sign(
      { uid: userId, aud: STREAM_AUDIENCE },
      {
        secret: this.cfg.streamTokenSecret,
        subject: jobId,
        expiresIn: this.cfg.streamTokenTtlSec,
      },
    );
  }

  /**
   * Verify a stream token and return its payload. Throws if invalid/expired or
   * the audience doesn't match. Does NOT check job ownership — the caller
   * binds `sub` (jobId) to the route param and `uid` to the job's owner.
   */
  verify(token: string): StreamTokenPayload {
    const payload = this.jwt.verify<StreamTokenPayload>(token, {
      secret: this.cfg.streamTokenSecret,
    });
    if (payload.aud !== STREAM_AUDIENCE) {
      throw new Error('invalid stream token audience');
    }
    return payload;
  }
}
