import { Global, Module } from '@nestjs/common';
import { ManualScannerDispatcher } from './manual-scanner-dispatcher';
import { SCANNER_DISPATCHER } from './scanner.types';

@Global()
@Module({
  providers: [{ provide: SCANNER_DISPATCHER, useClass: ManualScannerDispatcher }],
  exports: [SCANNER_DISPATCHER],
})
export class ScannersModule {}
