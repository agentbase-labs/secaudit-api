import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit:action';

/**
 * Mark a controller method as audit-loggable.
 * The interceptor reads this metadata + request/response to persist an AuditLog row.
 */
export const Audit = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);
