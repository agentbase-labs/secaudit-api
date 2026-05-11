import { HttpException, HttpStatus } from '@nestjs/common';
import type { PlanCapExceededBody, PlanSlug } from '@cs-platform/shared';
import { nextTierAbove } from './plans.constants';

/**
 * Structured 402 PAYMENT_REQUIRED for cap violations.
 *
 * `code: 'PLAN_CAP_EXCEEDED'` is the discriminator the frontend keys off
 * to show the upgrade modal. `cap` carries the specific violation; see
 * `Appendix B` of `design/plans/03-plan-engineering.md` for the canonical list.
 */
export class PlanCapExceededException extends HttpException {
  constructor(args: {
    cap: string;
    current: number | string;
    max: number | string;
    currentPlanId: string;
    /** Optional override for the upgrade hint (e.g. retention → suggest the next tier). */
    suggestUpgradeTo?: PlanSlug | null;
    /** Optional override for the human message. */
    message?: string;
  }) {
    const suggest =
      args.suggestUpgradeTo !== undefined
        ? args.suggestUpgradeTo
        : nextTierAbove(args.currentPlanId);
    const body: PlanCapExceededBody = {
      error: 'plan_cap_exceeded',
      code: 'PLAN_CAP_EXCEEDED',
      cap: args.cap,
      current: args.current,
      max: args.max,
      suggestUpgradeTo: suggest,
      message:
        args.message ??
        `Your ${args.currentPlanId} plan does not allow this action.${
          suggest ? ` Upgrade to ${suggest}.` : ''
        }`,
    };
    super(body, HttpStatus.PAYMENT_REQUIRED /* 402 */);
  }
}
