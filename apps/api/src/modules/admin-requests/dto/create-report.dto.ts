import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ReportUploadUrlDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @MaxLength(100)
  contentType!: string; // must equal 'application/pdf' (checked in service)

  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  fileSize!: number;
}

export class CreateReportDto {
  @IsString()
  @MaxLength(500)
  r2Key!: string;

  @IsInt()
  @Min(1)
  fileSize!: number;

  @IsOptional()
  @IsBoolean()
  pdfSelfEncrypted?: boolean;
}

export class RegeneratePasswordDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}
