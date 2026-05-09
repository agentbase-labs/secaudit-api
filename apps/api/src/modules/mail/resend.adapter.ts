import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { AppConfigService } from '../../config/config.service';
import type { EmailTemplate, EmailTemplateData, MailService } from './mail.service';
import { renderTemplate } from './templates';

@Injectable()
export class ResendMailService implements MailService {
  private readonly logger = new Logger('ResendMail');
  private readonly resend: Resend;
  private readonly from: string;

  constructor(private readonly cfg: AppConfigService) {
    const apiKey = cfg.get('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set — mails will fail if sent');
    }
    this.resend = new Resend(apiKey || 're_placeholder');
    this.from = cfg.get('FROM_EMAIL');
  }

  async sendTemplate<T extends EmailTemplate>(args: {
    to: string | string[];
    template: T;
    data: EmailTemplateData[T];
    replyTo?: string;
  }): Promise<{ id: string }> {
    const rendered = renderTemplate(args.template, args.data);
    const res = await this.resend.emails.send({
      from: this.from,
      to: Array.isArray(args.to) ? args.to : [args.to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: args.replyTo,
    });
    if ('error' in res && res.error) {
      throw new Error(`Resend failed: ${JSON.stringify(res.error)}`);
    }
    const id = (res.data && 'id' in res.data ? res.data.id : undefined) ?? 'unknown';
    return { id };
  }
}
