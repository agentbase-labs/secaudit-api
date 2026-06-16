import { JwtService } from '@nestjs/jwt';
import { StreamTokenService } from './stream-token.service';
import type { AppConfigService } from '../../config/config.service';

/**
 * StreamTokenService — mints + verifies the short-lived SSE stream tokens
 * (ACTIVE_SCAN_DESIGN.md §5.3). EventSource can't send Authorization, so the
 * stream is authed via this signed token bound to (jobId, userId).
 */
function makeService(opts?: { ttlSec?: number; secret?: string }): StreamTokenService {
  const jwt = new JwtService({});
  const cfg = {
    streamTokenSecret: opts?.secret ?? 'a-very-long-stream-token-secret-key-1234567890',
    streamTokenTtlSec: opts?.ttlSec ?? 600,
  } as unknown as AppConfigService;
  return new StreamTokenService(jwt, cfg);
}

describe('StreamTokenService', () => {
  const jobId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';

  it('signs a token that verifies back to (jobId, userId)', () => {
    const svc = makeService();
    const token = svc.sign(jobId, userId);
    expect(typeof token).toBe('string');

    const payload = svc.verify(token);
    expect(payload.sub).toBe(jobId);
    expect(payload.uid).toBe(userId);
    expect(payload.aud).toBe('active-scan-stream');
  });

  it('rejects a token signed with a different secret', () => {
    const signer = makeService({ secret: 'secret-A-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    const verifier = makeService({ secret: 'secret-B-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    const token = signer.sign(jobId, userId);
    expect(() => verifier.verify(token)).toThrow();
  });

  it('rejects an expired token', () => {
    const svc = makeService({ ttlSec: -1 }); // already expired
    const token = svc.sign(jobId, userId);
    expect(() => svc.verify(token)).toThrow();
  });

  it('rejects a token with the wrong audience', () => {
    const jwt = new JwtService({});
    const svc = makeService();
    const forged = jwt.sign(
      { uid: userId, aud: 'some-other-aud' },
      { secret: 'a-very-long-stream-token-secret-key-1234567890', subject: jobId },
    );
    expect(() => svc.verify(forged)).toThrow(/audience/);
  });

  it('exposes the configured TTL', () => {
    expect(makeService({ ttlSec: 300 }).ttlSec).toBe(300);
  });
});
