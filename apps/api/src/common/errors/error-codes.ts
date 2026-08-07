// PRD §17.9: "a code registry typed as a const union so a code cannot be
// invented ad hoc." Generic per-HTTP-class codes plus the specific codes the
// PRD names explicitly (§17.9's own INTENT_FLOOR_NOT_MET example, §10.7's
// messaging error table). More codes get added here as later phases
// introduce the routes that need them — never invented inline at the
// throw site.
export const ERROR_CODES = [
  // Generic, one per HTTP class in the §17.9 table.
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "GONE",
  "VALIDATION_FAILED",
  "TOO_MANY_REQUESTS",
  "INTERNAL_ERROR",

  // Matching (§11, §17.9 worked example).
  "INTENT_FLOOR_NOT_MET",

  // Messaging (§10.7).
  "NOT_CONVERSATION_MEMBER",
  "CONVERSATION_FROZEN",
  "BLOCKED",
  "AWAITING_REPLY",
  "MESSAGE_RATE_LIMIT",
  "MODERATION_REJECTED",
  "ATTACHMENT_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "MESSAGE_DELETED",
  "EDIT_WINDOW_EXPIRED",
  "CONVERSATION_NOT_FOUND",

  // Identity, Authentication & Onboarding (§10.1.7 error tables).
  "EMAIL_ALREADY_EXISTS",
  "PHONE_ALREADY_EXISTS",
  "AGE_RESTRICTED",
  "PASSWORD_BREACHED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_LOCKED",
  "ACCOUNT_SUSPENDED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_MAX_ATTEMPTS",
  "OTP_RATE_LIMITED",
  "TOKEN_EXPIRED",
  "TOKEN_USED",
  "INVALID_REFRESH_TOKEN",
  "TOKEN_REUSE_DETECTED",
  "SESSION_NOT_FOUND",

  // Auth guard / RBAC (§17.4 status gate, §20.3 deny-by-default).
  "VERIFICATION_REQUIRED",
  "POLICY_DENIED",

  // OAuth (§10.1.7 endpoint 10, §13 F1).
  "OAUTH_STATE_INVALID",
  "OAUTH_PROVIDER_UNKNOWN",

  // Profile (§10.2.9 error table).
  "PROFILE_NOT_FOUND",
  "ETAG_MISMATCH",
  "NAME_CHANGE_LIMIT",

  // Verification ladder (§10.2.5, P7.3).
  "WORK_EMAIL_DOMAIN_MISMATCH",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
