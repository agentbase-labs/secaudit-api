import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '@cs-platform/shared';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
