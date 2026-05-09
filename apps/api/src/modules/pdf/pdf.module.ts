import { Global, Module } from '@nestjs/common';
import { QpdfService } from './qpdf.service';

@Global()
@Module({
  providers: [QpdfService],
  exports: [QpdfService],
})
export class PdfModule {}
