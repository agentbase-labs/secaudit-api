import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from '../../config/config.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import type { MailService } from '../mail/mail.service';
import { ContactDto } from './dto/contact.dto';

@Controller('public')
export class ContactController {
  constructor(
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    private readonly cfg: AppConfigService,
  ) {}

  @Public()
  @Post('contact')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async contact(@Body() dto: ContactDto) {
    await this.mail
      .sendTemplate({
        to: this.cfg.get('CONTACT_INBOX_EMAIL'),
        template: 'contact-received',
        data: {
          name: dto.name,
          email: dto.email,
          companyName: dto.companyName,
          message: dto.message,
        },
        replyTo: dto.email,
      })
      .catch(() => undefined);
    return { message: 'received' };
  }
}
