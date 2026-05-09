import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AutoScanRunEntity } from './entities/auto-scan-run.entity';
import { AutoScanFindingEntity } from './entities/auto-scan-finding.entity';
import { AutoScanService } from './auto-scan.service';
import {
  AdminAutoScanController,
  ClientAutoScanController,
} from './auto-scan.controller';
import { HttpFingerprintScanner } from './scanners/http-fingerprint.scanner';
import { DnsReconScanner } from './scanners/dns-recon.scanner';
import { TlsCertScanner } from './scanners/tls-cert.scanner';
import { CrtShScanner } from './scanners/crt-sh.scanner';
import { MozillaObservatoryScanner } from './scanners/mozilla-observatory.scanner';
import { SslLabsScanner } from './scanners/ssl-labs.scanner';
import { NucleiScanner } from './scanners/nuclei.scanner';
import { NiktoScanner } from './scanners/nikto.scanner';
import { RequestsModule } from '../requests/requests.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AutoScanRunEntity, AutoScanFindingEntity]),
    forwardRef(() => RequestsModule),
  ],
  controllers: [AdminAutoScanController, ClientAutoScanController],
  providers: [
    AutoScanService,
    HttpFingerprintScanner,
    DnsReconScanner,
    TlsCertScanner,
    CrtShScanner,
    MozillaObservatoryScanner,
    SslLabsScanner,
    NucleiScanner,
    NiktoScanner,
  ],
  exports: [AutoScanService],
})
export class AutoScanModule {}
