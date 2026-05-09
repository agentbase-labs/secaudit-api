import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/config.service';
import type { EmailTemplate, EmailTemplateData, MailService } from './mail.service';
import { renderTemplate } from './templates';

@Injectable()
export class ConsoleMailService implements MailService {
  private readonly logger = new Logger('ConsoleMail');

  constructor(private readonly cfg: AppConfigService) {}

  async sendTemplate<T extends EmailTemplate>(args: {
    to: string | string[];
    template: T;
    data: EmailTemplateData[T];
    replyTo?: string;
  }): Promise<{ id: string }> {
    const rendered = renderTemplate(args.template, args.data);
    const to = Array.isArray(args.to) ? args.to.join(', ') : args.to;
    const from = this.cfg.get('FROM_EMAIL');
    const id = randomUUID();
    this.logger.log(
      `[mail:${args.template}] id=${id} from=${from} to=${to} subject="${rendered.subject}"`,
    );
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('--- EMAIL TEXT ---\n' + rendered.text + '\n--- END ---');
    }
    return { id };
  }
}
