import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password is too long')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

export const emailSchema = z.string().trim().toLowerCase().email('Invalid email address');

/**
 * Plan slug used by the public registration flow + (eventually)
 * `/public/plans` from the API. Kept in sync with
 * `design/plans/02-secaudit-plans.md`.
 */
export const PlanSlugSchema = z.enum(['free', 'starter', 'pro', 'business', 'enterprise']);
export type PlanSlug = z.infer<typeof PlanSlugSchema>;

export const BillingCycleSchema = z.enum(['monthly', 'annual']);
export type BillingCycle = z.infer<typeof BillingCycleSchema>;

export const RegisterSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: emailSchema,
  password: passwordSchema,
  companyName: z.string().trim().max(200).optional().or(z.literal('')),
  // Optional today (server defaults to `free` if absent). Once the
  // plans backend ships these become required client-side.
  planId: PlanSlugSchema.optional(),
  billingCycle: BillingCycleSchema.optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type RegisterDto = RegisterInput;

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const VerifyEmailSchema = z.object({
  token: z.string().min(10).max(500),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

export const ResendVerificationSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationInput = z.infer<typeof ResendVerificationSchema>;

export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(10).max(500),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export { passwordSchema };
