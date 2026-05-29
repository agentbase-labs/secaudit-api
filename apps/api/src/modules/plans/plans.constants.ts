import type { PlanSlug } from '@cs-platform/shared';

/** Authoritative plan-slug ordering for "next tier above" upgrade hints. */
export const PLAN_LADDER: PlanSlug[] = [
  'starter',
  'pro',
  'business',
  'enterprise',
];

/** Returns the next paid tier above the given plan, or null if at the top. */
export function nextTierAbove(currentPlanId: string): PlanSlug | null {
  const idx = PLAN_LADDER.indexOf(currentPlanId as PlanSlug);
  if (idx < 0) return null;
  if (idx >= PLAN_LADDER.length - 1) return null;
  return PLAN_LADDER[idx + 1] ?? null;
}

/** Start of the current UTC month. */
export function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Start of the current UTC calendar year. */
export function startOfUtcYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
}
