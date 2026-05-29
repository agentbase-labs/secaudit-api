import { AssetType, RequestStatus, TestingType, UserRole } from '../enums';
import type { BillingCycle, PlanSlug } from '../validation/auth';
import type {
  PlanChangeRequestStatus,
  SubscriptionStatus,
} from './plan';

export interface PublicUser {
  id: string;
  fullName: string;
  email: string;
  companyName: string | null;
  role: UserRole;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthLoginResponse {
  accessToken: string;
  user: PublicUser;
}

/**
 * Current subscription summary embedded in the admin user-detail payload.
 * Null when the user has no subscription row (should not happen for live users).
 */
export interface AdminUserSubscriptionSummary {
  id: string;
  planId: PlanSlug;
  status: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  startedAt: string;
  currentPeriodEnd: string | null;
  requestedPlanId: PlanSlug | null;
}

/** A single plan-change request in the admin user-detail payload. */
export interface AdminUserPlanChangeRequest {
  id: string;
  fromPlanId: PlanSlug;
  toPlanId: PlanSlug;
  status: PlanChangeRequestStatus;
  billingCycle: BillingCycle;
  createdAt: string;
  processedAt: string | null;
  notes: string | null;
}

/** A scan/audit (testing) request the user owns, summary-level. */
export interface AdminUserRequestSummary {
  id: string;
  assetType: AssetType;
  testingType: TestingType;
  status: RequestStatus;
  createdAt: string;
  hasReport: boolean;
}

/** A recent audit-log event for/by the user. */
export interface AdminUserAuditEvent {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

/**
 * Full per-user detail payload for the admin user-detail page
 * (GET /admin/users/:id). Assembled by AdminUsersService.getDetail().
 */
export interface AdminUserDetailResponse {
  user: PublicUser;
  subscription: AdminUserSubscriptionSummary | null;
  planChangeRequests: AdminUserPlanChangeRequest[];
  requests: AdminUserRequestSummary[];
  auditEvents: AdminUserAuditEvent[];
}
