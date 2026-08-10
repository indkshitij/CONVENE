import { z } from "zod";

// PRD §11 endpoint 31 (POST /matches/{id}/skip): "Not interested (+
// reason)." No PRD-stated length cap for the reason — 200 chars mirrors
// connections.ts's connectionNoteSchema's own order of magnitude for a
// short freeform explanation field, not a literal transcription.
export const skipReasonSchema = z.string().trim().min(1).max(200).optional();

export const skipMatchSchema = z.object({
  reason: skipReasonSchema,
});

export type SkipMatchInput = z.infer<typeof skipMatchSchema>;

// PRD AD-8/§11.11: the admin weight editor. §11.3's 11 sub-scores, each
// in [0,1] — the actual "sums to 1.00" invariant is enforced by
// @convene/matching's isValidWeights at the service layer (a DB-backed
// runtime check, not a static schema shape), so this only validates that
// every key is present and in range, not their sum.
const weightSchema = z.number().min(0).max(1);

// P26.2 (design.md §14.20's "Config" panel): "a mandatory change reason."
// Kept as its own field (never folded into `reason` on the audit log
// row automatically) so the admin's own stated rationale for the change
// is what's recorded, not a value the schema derives.
const changeReasonSchema = z.string().trim().min(1).max(500);

export const updateMatchingWeightsSchema = z.object({
  avail: weightSchema,
  intent: weightSchema,
  loc: weightSchema,
  skill: weightSchema,
  industry: weightSchema,
  exp: weightSchema,
  interest: weightSchema,
  mutual: weightSchema,
  activity: weightSchema,
  rep: weightSchema,
  lang: weightSchema,
  reason: changeReasonSchema,
});

export type UpdateMatchingWeightsInput = z.infer<typeof updateMatchingWeightsSchema>;

export const rollbackMatchingWeightsSchema = z.object({
  reason: changeReasonSchema,
});

export type RollbackMatchingWeightsInput = z.infer<typeof rollbackMatchingWeightsSchema>;
