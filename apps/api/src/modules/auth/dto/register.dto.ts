import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// Plan-slug + billing-cycle literal sets, matching
// `packages/shared/src/validation/auth.ts` zod enums.
const PLAN_SLUGS = ['starter', 'pro', 'business', 'enterprise'] as const;
const BILLING_CYCLES = ['monthly', 'annual'] as const;

export class RegisterDto {
  @IsString()
  @Length(2, 200)
  fullName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  @Matches(/[a-z]/, { message: 'Password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'Password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'Password must contain a digit' })
  @Matches(/[^A-Za-z0-9]/, { message: 'Password must contain a symbol' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  /**
   * Optional pre-selected plan from the marketing /signup page.
   * - undefined → defaults to 'starter'; the user lands on a Starter
   *   subscription (status pending) + a pending PlanChangeRequest
   *   (admin must approve in MVP — same 1-business-day review flow).
   * - 'starter' | 'pro' | 'business' → user lands on a Starter subscription
   *   (status pending) + a pending PlanChangeRequest to the chosen plan
   *   (admin must approve in MVP).
   * - 'enterprise' → rejected with 400 (§11 decision #3); the user must
   *   go through the /contact form for a sales conversation.
   */
  @IsOptional()
  @IsString()
  @IsEnum(PLAN_SLUGS)
  planId?: (typeof PLAN_SLUGS)[number];

  @IsOptional()
  @IsString()
  @IsEnum(BILLING_CYCLES)
  billingCycle?: (typeof BILLING_CYCLES)[number];
}
