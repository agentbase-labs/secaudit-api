import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ApprovePcrDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RejectPcrDto {
  @IsString()
  @MinLength(5)
  @Length(5, 1000)
  notes!: string;
}
