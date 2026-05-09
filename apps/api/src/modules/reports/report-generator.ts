import { Injectable, NotImplementedException } from '@nestjs/common';

export const REPORT_GENERATOR = 'ReportGenerator';

export interface ReportGeneratorInput {
  requestId: string;
  artifacts: { scanner: string; artifactKey: string }[];
  branding?: { logoUrl?: string; companyName?: string };
  pdfPassword: string;
}
export interface ReportGeneratorOutput {
  requestId: string;
  r2Key: string;
  fileSize: number;
  generatedAt: Date;
}

export interface ReportGenerator {
  generate(input: ReportGeneratorInput): Promise<ReportGeneratorOutput>;
}

@Injectable()
export class ManualReportGenerator implements ReportGenerator {
  // TODO(phase2): replace with real PDF generator. In MVP the admin uploads directly.
  async generate(_input: ReportGeneratorInput): Promise<ReportGeneratorOutput> {
    throw new NotImplementedException('Report generation is a Phase 2 feature');
  }
}
