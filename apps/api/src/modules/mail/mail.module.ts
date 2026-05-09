import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { MAIL_SERVICE } from './mail.service';
import { ConsoleMailService } from './console.adapter';
import { ResendMailService } from './resend.adapter';

@Global()
@Module({
  providers: [
    ConsoleMailService,
    ResendMailService,
    {
      provide: MAIL_SERVICE,
      inject: [AppConfigService, ConsoleMailService, ResendMailService],
      useFactory: (
        cfg: AppConfigService,
        consoleSvc: ConsoleMailService,
        resendSvc: ResendMailService,
      ) => {
        const provider = cfg.get('MAIL_PROVIDER');
        return provider === 'resend' ? resendSvc : consoleSvc;
      },
    },
  ],
  exports: [MAIL_SERVICE],
})
export class MailModule {}
