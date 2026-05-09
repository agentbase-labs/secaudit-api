import { RequestStatus } from '@cs-platform/shared';

/** Valid admin-driven transitions for MVP. Phase 2 adds auto statuses. */
export const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.SUBMITTED]: [RequestStatus.IN_REVIEW, RequestStatus.FAILED],
  [RequestStatus.IN_REVIEW]: [RequestStatus.TESTING_IN_PROGRESS, RequestStatus.FAILED],
  [RequestStatus.TESTING_IN_PROGRESS]: [RequestStatus.REPORT_READY, RequestStatus.FAILED],
  [RequestStatus.REPORT_READY]: [RequestStatus.COMPLETED, RequestStatus.TESTING_IN_PROGRESS],
  [RequestStatus.COMPLETED]: [],
  [RequestStatus.FAILED]: [RequestStatus.IN_REVIEW],
  // Phase 2 reserved (not used in MVP)
  [RequestStatus.QUEUED]: [RequestStatus.RUNNING, RequestStatus.FAILED],
  [RequestStatus.RUNNING]: [RequestStatus.GENERATING, RequestStatus.FAILED],
  [RequestStatus.GENERATING]: [RequestStatus.REPORT_READY, RequestStatus.FAILED],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
