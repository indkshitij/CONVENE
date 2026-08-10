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
  "MATCH_NOT_FOUND",

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

  // Intents (§10.4.6 error table, P8.1).
  "PLAN_LIMIT_REACHED",
  "DUPLICATE_INTENT",
  "INTENT_PREREQUISITE_UNMET",
  "INTENT_NOT_FOUND",

  // Connections send-time intent checks (§10.6.5/§10.6.6, P8.2 — reused
  // by the connections module, Phase 14, when POST /connections/requests
  // is built).
  "INTENT_FILTERED",
  "INTENT_MISMATCH",

  // Location (§10.5.7 error table, P9.1). INVALID_COORDINATES isn't
  // included — coordinate range validation goes through the standard
  // ZodValidationPipe -> VALIDATION_FAILED path (422), same as every
  // other field-shape error in this codebase, rather than the PRD's
  // route-specific 400 name.
  "GEOCODE_FAILED",
  "LOCATION_UPDATE_TOO_FREQUENT",

  // Availability (§10.3.8/§10.3.13 error tables, P10.1). SESSION_NOT_FOUND
  // is already declared above (auth refresh sessions) and reused here —
  // same generic "this session id doesn't resolve" meaning either way.
  "MAX_EXTENSIONS_REACHED",
  "SESSION_ALREADY_ENDED",
  "PREMIUM_REQUIRED",
  "PROFILE_PRIVATE",
  "INVALID_STATE_TRANSITION",

  // Recurring schedules (§10.3.8 error table, P10.3). PLAN_LIMIT_REACHED
  // is already declared above (P8.1 intents) and reused here.
  "SCHEDULE_OVERLAP",
  "SCHEDULE_NOT_FOUND",

  // Connections (§10.6.6 error table, P14.1). BLOCKED and
  // INTENT_FILTERED/INTENT_MISMATCH are already declared above and reused
  // here with the same meaning.
  "REQUEST_ALREADY_PENDING",
  "ALREADY_CONNECTED",
  "DAILY_LIMIT_REACHED",
  "VELOCITY_LIMIT",
  "RECIPIENT_THROTTLED",
  "COOLDOWN_ACTIVE",
  "REQUEST_NOT_FOUND",

  // Notifications (§10.8, P17.1).
  "CATEGORY_NOT_CONFIGURABLE",
  "DEVICE_NOT_FOUND",

  // Search (§10.9.2, P24.2). PREMIUM_REQUIRED (declared above, P10.1) is
  // reused for who-viewed-me's full-list gate — the same "you need
  // Premium for this, here's the exact feature" meaning, not a new code.
  "QUERY_TOO_SHORT",
  "PREMIUM_FILTER_REQUIRED",
  "SEARCH_RATE_LIMIT",

  // Trust, safety & the enforcement ladder (§10.10, P18.1).
  "REPORT_NOT_FOUND",
  "MODERATION_ACTION_NOT_FOUND",
  "APPEAL_NOT_FOUND",
  // BR-SAFE-01 (this phase's own name, no PRD BR- id exists for it):
  // "no moderation action can be taken without a policy clause and a
  // written rationale." Zod already requires both fields be present and
  // non-empty at the schema level (VALIDATION_FAILED); this code is for
  // the one case that isn't a shape problem — approving/activating a ban
  // whose originating action was never given one, which zod can't see.
  "POLICY_CLAUSE_REQUIRED",
  "APPEAL_REVIEWER_CONFLICT",
  "ACTION_NOT_PENDING_APPROVAL",
  "BAN_APPROVAL_SAME_ADMIN",
  "ALREADY_APPROVED",

  // Audit log (§20.8, P18.3).
  "AUDIT_LOG_IMMUTABLE",

  // AI gateway (§12.1/§12.12, P25.1).
  "AI_QUOTA_EXCEEDED",
  "AI_ABUSE_LIMIT",
  "AI_FEATURE_UNAVAILABLE",
  "AI_OUTPUT_REJECTED",

  // Matching weights editor (AD-8, P26.2).
  "NO_PREVIOUS_WEIGHTS_CONFIG",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
