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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
