import { z } from "zod";
import { containsEmailOrPhone } from "./common";

// PRD §10.4.2 — the 14-type intent taxonomy, transcribed verbatim by code.
export const INTENT_TYPES = [
  "looking_for_job",
  "hiring",
  "need_cofounder",
  "need_mentor",
  "need_mentee",
  "internship",
  "freelancer",
  "startup_discussion",
  "ai_collaboration",
  "business_networking",
  "coffee_chat",
  "learning",
  "investment_discussion",
  "partnerships",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

// PRD §10.4.5 `type`: "One of 14 enum values."
export const INTENT_TYPE_ERROR = "Unknown intent type";
export const intentTypeSchema = z.enum(INTENT_TYPES, { message: INTENT_TYPE_ERROR });

// PRD §10.4.5 `detail`: "≤ 200 chars; no contact info; moderation pass."
// Moderation (toxicity/spam classification, per BR-INT-09) is async and
// enforced by the moderation service, not this schema.
export const INTENT_DETAIL_ERROR = "Keep contact details out of intent details";

export const intentDetailSchema = z
  .string()
  .max(200, INTENT_DETAIL_ERROR)
  .refine((value) => !containsEmailOrPhone(value), INTENT_DETAIL_ERROR);

// PRD §10.4.5 `expires_in_days`: "∈ {7,14,30,90}."
export const EXPIRES_IN_DAYS_ERROR = "Choose 7, 14, 30 or 90 days";
const EXPIRES_IN_DAYS_OPTIONS = [7, 14, 30, 90] as const;

export const expiresInDaysSchema = z
  .number()
  .refine(
    (value): value is (typeof EXPIRES_IN_DAYS_OPTIONS)[number] =>
      (EXPIRES_IN_DAYS_OPTIONS as readonly number[]).includes(value),
    EXPIRES_IN_DAYS_ERROR,
  );

// PRD §10.4.5's remaining rows — "Duplicate type", "Plan limit", and
// "Prerequisites" — all require the user's existing intent records, plan,
// or profile/verification state to evaluate. None of that is available to
// a stateless input schema; they're enforced by the intents service at
// request time, not here. ("is_primary" is listed as "auto-managed
// server-side" in the same table — i.e. explicitly not a client input
// rule — so it's likewise not modelled as a validated input field.)
export const createIntentSchema = z.object({
  type: intentTypeSchema,
  detail: intentDetailSchema.optional(),
  expires_in_days: expiresInDaysSchema,
  is_primary: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// PRD §10.4.6: `PATCH /intents/:id { "detail":"...", "expires_in_days":90,
// "is_paused":true }` — type/is_primary aren't editable here (type is
// immutable once declared; is_primary has its own dedicated endpoint,
// POST /intents/:id/primary, since setting it is a whole-set operation —
// unsetting every other active intent's primary flag — not a per-row patch).
export const updateIntentSchema = z
  .object({
    detail: intentDetailSchema.nullable().optional(),
    expires_in_days: expiresInDaysSchema.optional(),
    is_paused: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// PRD §10.4.6: `POST /intents/:id/renew { "expires_in_days":30 }`.
export const renewIntentSchema = z
  .object({
    expires_in_days: expiresInDaysSchema,
  })
  .strict();

// PRD §10.4.6: `PUT /settings/inbound-intent-filters { "accepted_intents":
// [...], "min_experience_years":2, "max_experience_years":6,
// "industries":[3], "verified_only":true, "max_inbound_per_day":8 }`.
// Every field is optional/nullable — an absent or null value means "no
// restriction on this dimension," matching inbound_intent_filters'
// nullable columns (§10.4.7: "accepted_intents ... NULL = accept all").
export const MAX_INBOUND_PER_DAY_ERROR = "Choose a daily cap between 1 and 200";

export const inboundIntentFiltersSchema = z
  .object({
    accepted_intents: z.array(intentTypeSchema).nullable().optional(),
    min_experience_years: z.number().min(0).max(60).nullable().optional(),
    max_experience_years: z.number().min(0).max(60).nullable().optional(),
    industries: z.array(z.number().int()).nullable().optional(),
    verified_only: z.boolean().optional(),
    max_inbound_per_day: z
      .number()
      .int()
      .min(1, MAX_INBOUND_PER_DAY_ERROR)
      .max(200, MAX_INBOUND_PER_DAY_ERROR)
      .nullable()
      .optional(),
  })
  .strict();
