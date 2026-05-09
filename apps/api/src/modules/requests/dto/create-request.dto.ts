import { IsEnum, IsObject } from 'class-validator';
import { AssetType, TestingType } from '@cs-platform/shared';

/**
 * Class-validator provides the shell; the `details` field is re-validated
 * in the service using zod's discriminated union from `packages/shared`.
 */
export class CreateRequestDto {
  @IsEnum(AssetType)
  assetType!: AssetType;

  @IsEnum(TestingType)
  testingType!: TestingType;

  @IsObject()
  details!: Record<string, unknown>;
}
