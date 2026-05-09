import { Global, Module } from '@nestjs/common';
import { CRYPTO_SERVICE } from './crypto.service';
import { EnvKeyCryptoService } from './env-key-crypto.service';
import { ReportPasswordCipher } from './report-password.cipher';

@Global()
@Module({
  providers: [
    { provide: CRYPTO_SERVICE, useClass: EnvKeyCryptoService },
    ReportPasswordCipher,
  ],
  exports: [CRYPTO_SERVICE, ReportPasswordCipher],
})
export class CryptoModule {}
