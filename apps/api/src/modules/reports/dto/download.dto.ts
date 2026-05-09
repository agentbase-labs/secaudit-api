import { IsString, Length } from 'class-validator';

export class DownloadReportDto {
  @IsString()
  @Length(1, 200)
  password!: string;
}
