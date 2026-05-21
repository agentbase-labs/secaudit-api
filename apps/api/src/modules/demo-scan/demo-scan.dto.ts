import { IsString, IsUrl } from 'class-validator';

export class StartScanDto {
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;
}
