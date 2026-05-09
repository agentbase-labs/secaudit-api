import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class MobileUploadUrlDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsIn([
    'application/vnd.android.package-archive',
    'application/octet-stream',
    'application/zip',
  ])
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(500 * 1024 * 1024)
  fileSize!: number;
}
