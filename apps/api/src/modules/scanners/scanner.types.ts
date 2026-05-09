import type { AssetType, TestingType } from '@cs-platform/shared';

export const SCANNER_DISPATCHER = 'ScannerDispatcher';

export interface ScanTarget {
  requestId: string;
  assetType: AssetType;
  testingType: TestingType;
  details: unknown;
}

export interface ScanResultArtifact {
  requestId: string;
  scanner: string;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  summary: { findings: number; highest: 'info' | 'low' | 'medium' | 'high' | 'critical' };
  artifactKey: string;
  errors?: string[];
}

export interface Scanner {
  readonly name: string;
  supports(target: ScanTarget): boolean;
  run(target: ScanTarget): Promise<ScanResultArtifact>;
}

export interface ScannerDispatcher {
  dispatch(target: ScanTarget): Promise<ScanResultArtifact[]>;
}
