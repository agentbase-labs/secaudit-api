import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

const PLAN_SLUGS = ['free', 'starter', 'pro', 'business', 'enterprise'] as const;
const BILLING_CYCLES = ['monthly', 'annual'] as const;

export class ChangePlanDto {
  @IsString()
  @IsEnum(PLAN_SLUGS)
  toPlanId!: (typeof PLAN_SLUGS)[number];

  @IsString()
  @IsEnum(BILLING_CYCLES)
  billingCycle!: (typeof BILLING_CYCLES)[number];

  /** Optional user-supplied context for this change request (max 500 chars). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
