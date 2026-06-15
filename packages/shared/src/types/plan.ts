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
  CANCELLED = 'cancelled',
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

  // Active / Deep Scan caps (see ACTIVE_SCAN_DESIGN.md §7).
  //  - activeScansPerMonth: 0 disables active scans entirely; -1 unlimited.
  //  - activeScanConcurrency: max simultaneous running jobs for this user.
  //  - activeScanMaxTargets: max verified targets retained (0 = none).
  // Optional so historical seed rows (pre-active-scan) typecheck; the
  // migration backfills all four tiers and the guard treats `undefined`
  // exactly like `0` (disabled) — fail-closed.
  activeScansPerMonth?: number;
  activeScanConcurrency?: number;
  activeScanMaxTargets?: number;

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
  /** Active scans consumed in the current UTC month (active-scan feature). */
  activeScansCount?: number;
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

/**
 * Admin-facing row for `GET /admin/plan-change-requests`.
 * Mirrors the backend response: each row joins the user (id/email/fullName/companyName)
 * and includes the user's currently-active subscription so admins can sanity-check
 * what plan they are upgrading from.
 */
export interface AdminPlanChangeRequestUser {
  id: string;
  email: string;
  fullName: string;
  companyName: string | null;
  /** Snapshot of the user's currently-active subscription at list time. */
  currentSubscription?: {
    planId: PlanSlug;
    billingCycle: BillingCycle | null;
    status: SubscriptionStatus;
  } | null;
}

export interface AdminPlanChangeRequest {
  id: string;
  user: AdminPlanChangeRequestUser;
  fromPlanId: PlanSlug;
  toPlanId: PlanSlug;
  billingCycle: BillingCycle;
  status: PlanChangeRequestStatus;
  /** @deprecated use adminNotes */
  notes: string | null;
  /** Admin decision note (written on approve/reject). */
  adminNotes: string | null;
  /** User-supplied context note (submitted with the change request). */
  userNotes: string | null;
  createdAt: string;
  processedAt: string | null;
  processedBy: string | null;
}

export interface ApprovePlanChangeRequestResponse {
  /** Updated subscription after the plan change has been applied. */
  subscription: PublicSubscription;
}

/** Response from `POST /me/subscription/cancel-change`. */
export interface CancelChangeResponse {
  success: true;
  cancelledAt: string;
}

/** Single row in the user-facing PCR history list. */
export interface UserPlanChangeRequestItem {
  id: string;
  toPlanId: PlanSlug;
  toBillingCycle: BillingCycle;
  status: PlanChangeRequestStatus;
  /** User-supplied context note (if any). */
  userNotes: string | null;
  /** Admin decision note (visible to user after approve/reject). */
  adminNotes: string | null;
  createdAt: string;
  processedAt: string | null;
  processedBy: string | null;
}

/** Response from `GET /me/subscription/changes`. */
export interface ListUserPcrResponse {
  items: UserPlanChangeRequestItem[];
  total: number;
  page: number;
  pageSize: number;
}

