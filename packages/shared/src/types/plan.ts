/**
 * Plan caps & subscription public DTO types.
 *
 * Source of truth: `design/plans/02-secaudit-plans.md` + `03-plan-engineering.md`.
 *
 * Conventions:
 *  - Numeric quotas use `-1` for "unlimited" (cleaner than nullable in JSON / PG).
 *  - `0` means "feature disabled" (e.g. `mobileUploadMaxMb: 0` → upload returns 403).
 *  - `retestsPerRequest: null` means "unlimited"; `0` means "none included".
 *  - Money everywhere is integer USD cents.
 */

import { AssetType, TestingType } from '../enums';
import type { PlanSlug, BillingCycle } from '../validation/auth';

export enum SupportTier {
  COMMUNITY = 'community',
  EMAIL_72H = 'email_72h',
  EMAIL_24H = 'email_24h',
  PRIORITY_8H = 'priority_8h',
  DEDICATED_CSM = 'dedicated_csm',
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PENDING_UPGRADE = 'pending_upgrade',
  CANCELLED = 'cancelled',
}

export enum PlanChangeRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export interface PlanCaps {
  // Quotas
  submissionsPerMonth: number; // -1 = unlimited
  registeredAssetsMax: number; // -1 = unlimited
  manualPentestsPerYear: number; // 0 disables, -1 = unlimited
  mobileUploadMaxMb: number; // 0 disables
  seatsMax: number; // -1 = unlimited
  retentionDays: number; // report retention

  // Per-type sub-caps (null = no extra cap beyond submissionsPerMonth)
  perTypeSubmissionsPerMonth: Partial<Record<TestingType, number>> | null;

  // Allow lists
  allowedAssetTypes: AssetType[];
  allowedTestingTypes: TestingType[];

  // Boolean features
  redTeamEnabled: boolean;
  ssoEnabled: boolean;
  complianceReportEnabled: boolean;
  auditLogAccess: boolean;

  // Re-tests (null = unlimited, 0 = none)
  retestsPerRequest: number | null;

  // SLAs in business days (null = best-effort / not applicable)
  slaVulnBusinessDays: number | null;
  slaPentestBusinessDays: number | null;

  // Support
  supportTier: SupportTier;
}

/**
 * Public-facing plan record returned by `GET /public/plans`.
 * Caps are exposed as-is (marketing/UI build cap copy from this).
 */
export interface PublicPlan {
  id: PlanSlug;
  name: string;
  monthlyPriceUsdCents: number;
  annualPriceUsdCents: number;
  isPublic: boolean;
  sortOrder: number;
  caps: PlanCaps;
}

/** Shape of `subscription` returned by `GET /me/subscription` and embedded in `GET /auth/me`. */
export interface PublicSubscription {
  id: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  startedAt: string;
  currentPeriodEnd: string | null;
  requestedPlanId: PlanSlug | null;
  plan: {
    id: PlanSlug;
    name: string;
    caps: PlanCaps;
  };
  pendingChangeRequest: {
    id: string;
    toPlanId: PlanSlug;
    billingCycle: BillingCycle;
    createdAt: string;
  } | null;
  /** Convenience field — same as `pendingChangeRequest.toPlanId`. Powers the dashboard banner. */
  requestedPlan: PlanSlug | null;
}

export interface PublicUsageCounter {
  periodStart: string;
  submissionsCount: number;
  sourceReviewsCount: number;
  manualPentestsCountYtd: number;
  mobileUploadBytesUsed: string;
}

export interface MeSubscriptionResponse {
  subscription: PublicSubscription;
  usage: PublicUsageCounter;
}

/** Structured 402 error body for cap violations. */
export interface PlanCapExceededBody {
  error: 'plan_cap_exceeded';
  code: 'PLAN_CAP_EXCEEDED';
  cap: string;
  current: number | string;
  max: number | string;
  suggestUpgradeTo: PlanSlug | null;
  message: string;
}
