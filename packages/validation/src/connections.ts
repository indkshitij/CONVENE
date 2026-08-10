import { z } from "zod";
import { containsEmailOrPhone } from "./common";

// PRD §10.6.5 `recipient_id` / `intent_id`: "Exists, not self, not blocked
// either way, discoverable to sender" / "Active, unpaused, owned by
// sender." Existence, blocking, discoverability, and intent ownership/
// active-state are all DB lookups against other records — not expressible
// in a stateless input schema. These validate only that the ids are
// well-formed; the connections service enforces the rest at request time.
export const RECIPIENT_ID_ERROR = "This person isn't available to connect";
export const INTENT_ID_ERROR = "Select an active intent";

export const recipientIdSchema = z.string().min(1, RECIPIENT_ID_ERROR);
export const intentIdSchema = z.string().min(1, INTENT_ID_ERROR);

// PRD §10.6.5 `note`: "≤ 300 chars, moderation pass, no contact info."
// Moderation is an async classifier call, enforced by the moderation
// service, not this schema.
export const CONNECTION_NOTE_ERROR = "Please remove contact details from your note";

export const connectionNoteSchema = z
  .string()
  .max(300, CONNECTION_NOTE_ERROR)
  .refine((value) => !containsEmailOrPhone(value), CONNECTION_NOTE_ERROR);

// PRD §10.6.5's remaining rows — "Existing relationship", "Rate limits",
// "Intent floor", and "Inbound filter" — all require state this package
// doesn't have access to (the connection graph, Redis rate-limit counters,
// the computed match score, the recipient's filter config). They're
// enforced by the connections service and the rate-limit guard
// (apps/api/src/common/rate-limit), not modelled as schema rules here.
export const createConnectionRequestSchema = z.object({
  recipient_id: recipientIdSchema,
  intent_id: intentIdSchema,
  note: connectionNoteSchema.optional(),
  source: z.string().optional(),
  match_score: z.number().optional(),
});

// PRD §10.6.6: `POST /blocks { "user_id":"...", "reason":"harassment" }`.
export const createBlockSchema = z.object({
  user_id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

// PRD §10.6.6 report contract — no stated length limit on `description` in
// any §10 table, so none is invented here.
export const REPORT_TARGET_TYPES = ["user", "message", "profile", "conversation"] as const;
export const REPORT_CATEGORIES = [
  "spam",
  "harassment",
  "fake_profile",
  "inappropriate_content",
  "scam",
  "impersonation",
  "off_platform_solicitation",
  "other",
] as const;

export const createReportSchema = z.object({
  target_type: z.enum(REPORT_TARGET_TYPES),
  target_id: z.string().min(1),
  category: z.enum(REPORT_CATEGORIES),
  description: z.string().optional(),
  evidence_message_ids: z.array(z.string()).optional(),
  also_block: z.boolean().optional(),
});
