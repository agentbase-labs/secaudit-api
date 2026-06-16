export const ApiErrorCodes = {
  // validation
  VALIDATION_ERROR: 'validation_error',
  EMPTY_BODY: 'empty_body',
  // auth
  INVALID_CREDENTIALS: 'invalid_credentials',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  ACCOUNT_DISABLED: 'account_disabled',
  EMAIL_TAKEN: 'email_taken',
  TOKEN_INVALID: 'token_invalid',
  TOKEN_EXPIRED: 'token_expired',
  REFRESH_INVALID: 'refresh_invalid',
  PASSWORD_INVALID: 'password_invalid',
  // access
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_OWNER: 'not_owner',
  SELF_MODIFY_FORBIDDEN: 'self_modify_forbidden',
  // resources
  NOT_FOUND: 'not_found',
  REQUEST_LOCKED: 'request_locked',
  INVALID_TRANSITION: 'invalid_transition',
  TARGET_NOT_VERIFIED: 'target_not_verified',
  // rate
  THROTTLED: 'throttled',
  // server
  INTERNAL: 'internal_error',
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];

export interface ApiErrorBody {
  error: ApiErrorCode | string;
  message: string;
  details?: unknown;
}
