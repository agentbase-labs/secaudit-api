import { Injectable, Logger } from '@nestjs/common';
import type { ScanResultArtifact, ScanTarget, ScannerDispatcher } from './scanner.types';

@Injectable()
export class ManualScannerDispatcher implements ScannerDispatcher {
  private readonly logger = new Logger('ManualScannerDispatcher');

  // TODO(phase2): wire real scanners; in MVP a human admin drives the workflow.
  async dispatch(target: ScanTarget): Promise<ScanResultArtifact[]> {
    this.logger.log(
      `[manual] dispatch no-op for request=${target.requestId} asset=${target.assetType} testing=${target.testingType}`,
    );
    return [];
  }
}
