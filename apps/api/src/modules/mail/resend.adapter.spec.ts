import { ResendMailService } from './resend.adapter';
import type { AppConfigService } from '../../config/config.service';

/**
 * Unit tests for ResendMailService.
 *
 *   - When RESEND_API_KEY is missing → no-op (no SDK call, no throw).
 *   - When the SDK returns a Resend error → log + swallow (no throw).
 *   - When the SDK throws → log + swallow (no throw).
 *   - When the SDK succeeds → returns the message id.
 *   - From address precedence: RESEND_FROM_EMAIL > FROM_EMAIL > default.
 *
 * We mock the `resend` SDK module so no real HTTP happens.
 */

const sendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => sendMock(...args) },
  })),
}));

function makeCfg(values: Record<string, string | undefined>): AppConfigService {
  return {
    get: jest.fn().mockImplementation((k: string) => values[k]),
  } as unknown as AppConfigService;
}

const sampleArgs = {
  to: 'jane@example.com',
  template: 'welcome-signup' as const,
  data: {
    fullName: 'Jane Doe',
    planName: 'Starter',
    pendingUpgrade: false,
    dashboardUrl: 'https://app.secaudit.xyz/dashboard',
  },
};

describe('ResendMailService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.FROM_EMAIL;
  });

  it('no-ops when RESEND_API_KEY is missing (returns id=noop, no SDK call)', async () => {
    const cfg = makeCfg({ RESEND_API_KEY: '', FROM_EMAIL: 'noreply@example.com' });
    const svc = new ResendMailService(cfg);
    const res = await svc.sendTemplate(sampleArgs);
    expect(res).toEqual({ id: 'noop' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns id from a successful Resend send', async () => {
    sendMock.mockResolvedValue({ data: { id: 'res-123' }, error: null });
    const cfg = makeCfg({
      RESEND_API_KEY: 're_test',
      FROM_EMAIL: 'noreply@secaudit.xyz',
    });
    const svc = new ResendMailService(cfg);
    const res = await svc.sendTemplate(sampleArgs);
    expect(res).toEqual({ id: 'res-123' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0]![0];
    expect(call.from).toBe('noreply@secaudit.xyz');
    expect(call.to).toEqual(['jane@example.com']);
    expect(call.subject).toMatch(/Welcome to SecAudit/);
    expect(typeof call.html).toBe('string');
    expect(typeof call.text).toBe('string');
  });

  it('prefers RESEND_FROM_EMAIL over FROM_EMAIL', async () => {
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const cfg = makeCfg({
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'mail@secaudit.xyz',
      FROM_EMAIL: 'noreply@secaudit.xyz',
    });
    const svc = new ResendMailService(cfg);
    await svc.sendTemplate(sampleArgs);
    expect(sendMock.mock.calls[0]![0].from).toBe('mail@secaudit.xyz');
  });

  it('swallows Resend-side errors and returns id=error (does not throw)', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'invalid from' },
    });
    const cfg = makeCfg({
      RESEND_API_KEY: 're_test',
      FROM_EMAIL: 'noreply@secaudit.xyz',
    });
    const svc = new ResendMailService(cfg);
    const res = await svc.sendTemplate(sampleArgs);
    expect(res).toEqual({ id: 'error' });
  });

  it('swallows transport throws and returns id=error', async () => {
    sendMock.mockRejectedValue(new Error('ECONNRESET'));
    const cfg = makeCfg({
      RESEND_API_KEY: 're_test',
      FROM_EMAIL: 'noreply@secaudit.xyz',
    });
    const svc = new ResendMailService(cfg);
    const res = await svc.sendTemplate(sampleArgs);
    expect(res).toEqual({ id: 'error' });
  });
});
