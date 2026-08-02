import { z } from "zod";
import { INTENT_TYPES } from "./intents";

// §10.9 has no dedicated "Validation Rules" table (unlike §10.1/§10.2/
// §10.3/§10.4/§10.6) — these schemas are derived from §10.9.2's
// specification text and API contract instead of a Validation Rules row.
// §10.9.2 names HTTP error *codes* (QUERY_TOO_SHORT, PREMIUM_FILTER_
// REQUIRED, SEARCH_RATE_LIMIT) but no exact user-facing copy, so the
// messages below are plain descriptive text, not a transcription.

// PRD §10.9.2: "Query ≥ 2 chars."
export const SEARCH_QUERY_ERROR = "Search for at least 2 characters";
export const searchQuerySchema = z.string().min(2, SEARCH_QUERY_ERROR);

// PRD §10.9.2 filters: "skills (AND/OR)."
export const SKILLS_OP_ERROR = "Choose AND or OR for skill matching";
export const skillsOpSchema = z.enum(["and", "or"], { message: SKILLS_OP_ERROR });

// PRD §10.2.2 `years_experience`: "0–60" — reused here for the search
// filter's experience range.
export const EXPERIENCE_RANGE_ERROR = "Experience must be between 0 and 60 years";
export const experienceYearsSchema = z
  .number()
  .min(0, EXPERIENCE_RANGE_ERROR)
  .max(60, EXPERIENCE_RANGE_ERROR);

// PRD §10.3.4 — the six availability states, transcribed by state name for
// the search filter.
export const AVAILABILITY_STATE_ERROR = "Choose a valid availability state";
export const availabilityStateSchema = z.enum(
  ["available_now", "busy", "away", "invisible", "offline", "scheduled"],
  { message: AVAILABILITY_STATE_ERROR },
);

// PRD §10.9.2: "results capped at 200 with cursor pagination."
export const SEARCH_LIMIT_ERROR = "Limit must be between 1 and 200";
export const searchLimitSchema = z
  .number()
  .int()
  .min(1, SEARCH_LIMIT_ERROR)
  .max(200, SEARCH_LIMIT_ERROR);

// PRD §10.9.2 API contract shows only `sort=relevance` for /search/users.
export const searchSortSchema = z.enum(["relevance"]);

export const searchUsersSchema = z.object({
  q: searchQuerySchema,
  intents: z.array(z.enum(INTENT_TYPES)).optional(),
  industry: z.number().int().positive().optional(),
  skills: z.array(z.string()).optional(),
  skills_op: skillsOpSchema.optional(),
  min_exp: experienceYearsSchema.optional(),
  max_exp: experienceYearsSchema.optional(),
  availability: availabilityStateSchema.optional(),
  radius_km: z.number().positive().optional(),
  verified_only: z.boolean().optional(),
  sort: searchSortSchema.optional(),
  cursor: z.string().optional(),
});
