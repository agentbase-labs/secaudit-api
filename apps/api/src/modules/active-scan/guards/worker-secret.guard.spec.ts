import { ExecutionContext } from '@nestjs/common';
import { WorkerSecretGuard } from './worker-secret.guard';
import type { AppConfigService } from '../../../config/config.service';

/**
 * WorkerSecretGuard — authenticates the internal worker endpoints via the
 * `X-Worker-Secret` header (constant-time compare). Tests the reject paths
 * (bad / missing secret, unconfigured env) and the accept path.
 */
function ctxWithHeader(secret?: string): ExecutionContext {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers['x-worker-secret'] = secret;
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(envSecret: string): WorkerSecretGuard {
  const cfg = { activeScanWorkerSecret: envSecret } as unknown as AppConfigService;
  return new WorkerSecretGuard(cfg);
}

describe('WorkerSecretGuard', () => {
  it('accepts a matching secret', () => {
    const guard = makeGuard('s3cr3t-worker-token');
    expect(guard.canActivate(ctxWithHeader('s3cr3t-worker-token'))).toBe(true);
  });

  it('rejects a wrong secret', () => {
    const guard = makeGuard('s3cr3t-worker-token');
    expect(() => guard.canActivate(ctxWithHeader('wrong'))).toThrow(/Invalid worker secret/);
  });

  it('rejects a missing header', () => {
    const guard = makeGuard('s3cr3t-worker-token');
    expect(() => guard.canActivate(ctxWithHeader(undefined))).toThrow(/Invalid worker secret/);
  });

  it('fails closed when the env secret is unset (endpoint disabled)', () => {
    const guard = makeGuard('');
    expect(() => guard.canActivate(ctxWithHeader('anything'))).toThrow(/disabled/);
  });

  it('is not vulnerable to length-based early return (different lengths still reject)', () => {
    const guard = makeGuard('short');
    expect(() => guard.canActivate(ctxWithHeader('a-much-longer-wrong-secret'))).toThrow(
      /Invalid worker secret/,
    );
  });
});
