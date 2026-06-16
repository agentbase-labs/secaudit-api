import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const VERIFY_METHODS = ['dns_txt', 'http_file'] as const;
const FINDING_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
const COMPLETE_STATUSES = ['completed', 'failed'] as const;

// ───────────────────────────── Client DTOs ──────────────────────────────────

export class AddTargetDto {
  @IsString()
  @MaxLength(300)
  hostname!: string;
}

export class VerifyTargetDto {
  @IsOptional()
  @IsString()
  @IsIn(VERIFY_METHODS)
  method?: (typeof VERIFY_METHODS)[number];
}

export class RequestScanDto {
  @IsString()
  targetId!: string;

  @IsBoolean()
  authorizationAccepted!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  authorizationVersion?: string;
}

export class ListScansQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

// ─────────────────────── Internal worker→backend DTOs ───────────────────────

export class WorkerProgressDto {
  @IsInt()
  @Min(0)
  @Max(100)
  progressPct!: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  currentPhase?: string | null;
}

export class WorkerFindingDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  dedupKey?: string;

  @IsOptional()
  @IsString()
  target?: string | null;

  @IsString()
  @MaxLength(45)
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  port?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  service?: string | null;

  @IsString()
  @MaxLength(80)
  check!: string;

  @IsString()
  @MaxLength(40)
  source!: string;

  @IsString()
  @IsIn(FINDING_SEVERITIES)
  severity!: (typeof FINDING_SEVERITIES)[number];

  @IsString()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  remediation?: string | null;

  @IsOptional()
  referenceUrls?: string[];

  @IsOptional()
  @IsString()
  firstSeen?: string;

  @IsOptional()
  @IsString()
  lastSeen?: string;
}

export class WorkerFindingsDto {
  // Note: deep per-element validation is performed in the service (the payload
  // is worker-internal + secret-gated); we accept the array shape here.
  @IsOptional()
  findings?: WorkerFindingDto[];

  @IsOptional()
  hosts?: Array<Record<string, unknown>>;

  @IsOptional()
  errors?: Array<Record<string, unknown>>;
}

export class WorkerCompleteDto {
  @IsString()
  @IsIn(COMPLETE_STATUSES)
  status!: (typeof COMPLETE_STATUSES)[number];

  @IsOptional()
  @IsObject()
  summary?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  findingCounts?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  errorReason?: string | null;

  @IsOptional()
  @IsString()
  errorLog?: string | null;
}
