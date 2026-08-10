import { z } from "zod";

// PRD §10.10.2 — the eight report categories, transcribed as stable
// snake_case slugs (see packages/db/src/schema/safety.ts's own comment
// for the DB CHECK constraint using these same values).
export const REPORT_CATEGORIES = [
  "child_safety",
  "threats_violence",
  "harassment_hate",
  "scam_fraud",
  "sexual_content",
  "impersonation",
  "spam",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export const reportCategorySchema = z.enum(REPORT_CATEGORIES);

// §10.10 endpoint 50: "POST /reports." No exact request shape is given in
// the PRD beyond the report's target/category/description — targetType
// mirrors messages.repository.ts's existing usage ("message", "user",
// "profile", etc.), left as free text since the PRD doesn't enumerate it.
export const createReportSchema = z.object({
  target_type: z.string().min(1),
  target_id: z.string(),
  target_user_id: z.string().nullable().optional(),
  category: reportCategorySchema,
  description: z.string().max(2000).nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

// §10.10 endpoint 52: "POST /appeals."
export const createAppealSchema = z.object({
  moderation_action_id: z.string(),
  reason: z.string().min(1).max(2000),
});

export const REVIEW_APPEAL_DECISIONS = ["upheld", "overturned"] as const;
export const reviewAppealSchema = z.object({
  decision: z.enum(REVIEW_APPEAL_DECISIONS),
  rationale: z.string().min(1).max(2000),
});

// §10.10.3 enforcement ladder step names — the same six the DB's
// chk_moderation_action CHECK already restricts `action` to.
export const MODERATION_ACTIONS = [
  "notice",
  "warning",
  "throttle",
  "shadow_limit",
  "suspend",
  "ban",
  "reverse",
] as const;
export type ModerationActionType = (typeof MODERATION_ACTIONS)[number];

// §10.10.4: "action panel with mandatory policy-clause selection and
// free-text rationale" — both required and non-empty at the schema
// level; POLICY_CLAUSE_REQUIRED (error-codes.ts) exists for the one case
// this can't catch (a pre-existing action missing one at approval time).
export const applyModerationActionSchema = z.object({
  target_user_id: z.string(),
  report_id: z.string().nullable().optional(),
  action: z.enum(MODERATION_ACTIONS),
  policy_clause: z.string().min(1),
  rationale: z.string().min(1).max(2000),
  expires_at: z.string().datetime().nullable().optional(),
});

// endpoint 64's own approval step (P18.1 addition — see
// admin-moderation-actions.controller.ts's own comment for why this
// exists beyond the PRD's 4 listed endpoints).
export const approveModerationActionSchema = z.object({
  rationale: z.string().min(1).max(2000),
});

export const REPORT_STATUSES = ["open", "in_review", "upheld", "dismissed", "escalated"] as const;
export const updateReportSchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  assigned_to: z.string().nullable().optional(),
});
