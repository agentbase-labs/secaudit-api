import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { AppConfigService } from '../../config/config.service';
import type { EmailTemplate, EmailTemplateData, MailService } from './mail.service';
import { renderTemplate } from './templates';

/**
 * Resend SDK adapter.
 *
 * Best-effort delivery: missing API key, transport errors, and Resend-side
 * errors are logged but never thrown. Callers (auth/PCR flows) treat
 * email as fire-and-forget and must not block API responses on it.
 *
 * Env precedence for the From address:
 *   RESEND_FROM_EMAIL  >  FROM_EMAIL  >  'no-reply@secaudit.xyz'
 */
@Injectable()
export class ResendMailService implements MailService {
  private readonly logger = new Logger('ResendMail');
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly cfg: AppConfigService) {
    const apiKey = this.envOrEmpty('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'RESEND_API_KEY not set \u2014 ResendMailService will no-op on send (no emails will be delivered)',
      );
      this.resend = null;
    } else {
      this.resend = new Resend(apiKey);
    }
    this.from =
      this.envOrEmpty('RESEND_FROM_EMAIL') ||
      this.envOrEmpty('FROM_EMAIL') ||
      'no-reply@secaudit.xyz';
  }

  async sendTemplate<T extends EmailTemplate>(args: {
    to: string | string[];
    template: T;
    data: EmailTemplateData[T];
    replyTo?: string;
  }): Promise<{ id: string }> {
    const rendered = renderTemplate(args.template, args.data);
    const to = Array.isArray(args.to) ? args.to : [args.to];

    if (!this.resend) {
      this.logger.warn(
        `[mail:${args.template}] no-op (RESEND_API_KEY missing) to=${to.join(', ')} subject="${rendered.subject}"`,
      );
      return { id: 'noop' };
    }

    try {
      const res = await this.resend.emails.send({
        from: this.from,
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: args.replyTo,
      });
      if ('error' in res && res.error) {
        // Don't throw \u2014 emails are best-effort. Log so ops can see it.
        this.logger.error(
          `[mail:${args.template}] resend error to=${to.join(', ')}: ${JSON.stringify(res.error)}`,
        );
        return { id: 'error' };
      }
      const id = (res.data && 'id' in res.data ? res.data.id : undefined) ?? 'unknown';
      this.logger.log(
        `[mail:${args.template}] sent id=${id} from=${this.from} to=${to.join(', ')}`,
      );
      return { id };
    } catch (e) {
      this.logger.error(
        `[mail:${args.template}] send threw to=${to.join(', ')}: ${(e as Error).message}`,
      );
      return { id: 'error' };
    }
  }

  /**
   * Reads from cfg with a fallback to process.env, since AppConfigService is
   * strict-typed via zod \u2014 keys we add at runtime (RESEND_FROM_EMAIL,
   * RESEND_ADMIN_EMAIL) wouldn't be in the schema until env.schema.ts is
   * extended. We support both paths.
   */
  private envOrEmpty(key: string): string {
    const fromCfg = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.cfg as any).get(key);
      } catch {
        return undefined;
      }
    })();
    const v = (fromCfg ?? process.env[key] ?? '').toString();
    return v.trim();
  }
}
