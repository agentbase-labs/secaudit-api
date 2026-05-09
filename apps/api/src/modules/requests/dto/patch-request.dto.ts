import { IsObject, IsOptional } from 'class-validator';

export class PatchRequestDto {
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
