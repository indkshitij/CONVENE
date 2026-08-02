import { type IntentRef, type IntentType, clamp } from "../types";

export type ComplementarityMatrix = Record<IntentType, Record<IntentType, number>>;

// PRD §11.5.2 — the 14×14 complementarity matrix, transcribed verbatim
// from the table's "principal non-zero entries." This is the launch
// default; production loads the full matrix from remote config (§11.1)
// and only falls back to this object if that lookup fails.
export const DEFAULT_COMPLEMENTARITY_MATRIX: ComplementarityMatrix = {
  looking_for_job: {
    looking_for_job: 0.3,
    hiring: 1.0,
    need_cofounder: 0.35,
    need_mentor: 0.45,
    need_mentee: 0.2,
    internship: 0.25,
    freelancer: 0.15,
    startup_discussion: 0.3,
    ai_collaboration: 0.3,
    business_networking: 0.4,
    coffee_chat: 0.45,
    learning: 0.35,
    investment_discussion: 0.1,
    partnerships: 0.2,
  },
  hiring: {
    looking_for_job: 1.0,
    hiring: 0.25,
    need_cofounder: 0.4,
    need_mentor: 0.2,
    need_mentee: 0.4,
    internship: 0.9,
    freelancer: 0.85,
    startup_discussion: 0.4,
    ai_collaboration: 0.4,
    business_networking: 0.55,
    coffee_chat: 0.45,
    learning: 0.2,
    investment_discussion: 0.25,
    partnerships: 0.55,
  },
  need_cofounder: {
    looking_for_job: 0.35,
    hiring: 0.4,
    need_cofounder: 1.0,
    need_mentor: 0.35,
    need_mentee: 0.35,
    internship: 0.15,
    freelancer: 0.4,
    startup_discussion: 0.6,
    ai_collaboration: 0.55,
    business_networking: 0.45,
    coffee_chat: 0.45,
    learning: 0.25,
    investment_discussion: 0.5,
    partnerships: 0.55,
  },
  need_mentor: {
    looking_for_job: 0.45,
    hiring: 0.2,
    need_cofounder: 0.35,
    need_mentor: 0.25,
    need_mentee: 1.0,
    internship: 0.3,
    freelancer: 0.2,
    startup_discussion: 0.35,
    ai_collaboration: 0.4,
    business_networking: 0.4,
    coffee_chat: 0.5,
    learning: 0.55,
    investment_discussion: 0.15,
    partnerships: 0.2,
  },
  need_mentee: {
    looking_for_job: 0.2,
    hiring: 0.4,
    need_cofounder: 0.35,
    need_mentor: 1.0,
    need_mentee: 0.2,
    internship: 0.45,
    freelancer: 0.25,
    startup_discussion: 0.35,
    ai_collaboration: 0.45,
    business_networking: 0.45,
    coffee_chat: 0.5,
    learning: 0.7,
    investment_discussion: 0.2,
    partnerships: 0.25,
  },
  internship: {
    looking_for_job: 0.25,
    hiring: 0.9,
    need_cofounder: 0.15,
    need_mentor: 0.55,
    need_mentee: 0.15,
    internship: 0.3,
    freelancer: 0.15,
    startup_discussion: 0.25,
    ai_collaboration: 0.35,
    business_networking: 0.3,
    coffee_chat: 0.4,
    learning: 0.5,
    investment_discussion: 0.05,
    partnerships: 0.1,
  },
  freelancer: {
    looking_for_job: 0.15,
    hiring: 0.85,
    need_cofounder: 0.4,
    need_mentor: 0.25,
    need_mentee: 0.3,
    internship: 0.15,
    freelancer: 0.35,
    startup_discussion: 0.4,
    ai_collaboration: 0.45,
    business_networking: 0.6,
    coffee_chat: 0.45,
    learning: 0.3,
    investment_discussion: 0.2,
    partnerships: 0.8,
  },
  startup_discussion: {
    looking_for_job: 0.3,
    hiring: 0.4,
    need_cofounder: 0.6,
    need_mentor: 0.4,
    need_mentee: 0.4,
    internship: 0.2,
    freelancer: 0.4,
    startup_discussion: 1.0,
    ai_collaboration: 0.55,
    business_networking: 0.55,
    coffee_chat: 0.6,
    learning: 0.4,
    investment_discussion: 0.7,
    partnerships: 0.6,
  },
  ai_collaboration: {
    looking_for_job: 0.3,
    hiring: 0.4,
    need_cofounder: 0.55,
    need_mentor: 0.45,
    need_mentee: 0.45,
    internship: 0.3,
    freelancer: 0.5,
    startup_discussion: 0.55,
    ai_collaboration: 1.0,
    business_networking: 0.45,
    coffee_chat: 0.55,
    learning: 0.6,
    investment_discussion: 0.3,
    partnerships: 0.55,
  },
  business_networking: {
    looking_for_job: 0.4,
    hiring: 0.55,
    need_cofounder: 0.45,
    need_mentor: 0.4,
    need_mentee: 0.45,
    internship: 0.3,
    freelancer: 0.6,
    startup_discussion: 0.55,
    ai_collaboration: 0.45,
    business_networking: 0.85,
    coffee_chat: 0.7,
    learning: 0.4,
    investment_discussion: 0.45,
    partnerships: 0.75,
  },
  coffee_chat: {
    looking_for_job: 0.45,
    hiring: 0.45,
    need_cofounder: 0.45,
    need_mentor: 0.5,
    need_mentee: 0.5,
    internship: 0.4,
    freelancer: 0.45,
    startup_discussion: 0.6,
    ai_collaboration: 0.55,
    business_networking: 0.7,
    coffee_chat: 0.9,
    learning: 0.55,
    investment_discussion: 0.35,
    partnerships: 0.5,
  },
  learning: {
    looking_for_job: 0.35,
    hiring: 0.2,
    need_cofounder: 0.25,
    need_mentor: 0.55,
    need_mentee: 0.7,
    internship: 0.5,
    freelancer: 0.3,
    startup_discussion: 0.4,
    ai_collaboration: 0.6,
    business_networking: 0.4,
    coffee_chat: 0.55,
    learning: 0.85,
    investment_discussion: 0.15,
    partnerships: 0.25,
  },
  investment_discussion: {
    looking_for_job: 0.1,
    hiring: 0.25,
    need_cofounder: 0.5,
    need_mentor: 0.15,
    need_mentee: 0.2,
    internship: 0.05,
    freelancer: 0.2,
    startup_discussion: 0.7,
    ai_collaboration: 0.3,
    business_networking: 0.45,
    coffee_chat: 0.35,
    learning: 0.15,
    investment_discussion: 0.6,
    partnerships: 0.5,
  },
  partnerships: {
    looking_for_job: 0.2,
    hiring: 0.55,
    need_cofounder: 0.55,
    need_mentor: 0.2,
    need_mentee: 0.25,
    internship: 0.1,
    freelancer: 0.8,
    startup_discussion: 0.6,
    ai_collaboration: 0.55,
    business_networking: 0.75,
    coffee_chat: 0.5,
    learning: 0.25,
    investment_discussion: 0.5,
    partnerships: 0.95,
  },
};

export interface IntentScoreOptions {
  /** Defaults to DEFAULT_COMPLEMENTARITY_MATRIX. */
  matrix?: ComplementarityMatrix;
  /**
   * Cosine similarity between the two intents' free-text `detail` fields.
   * Computing real embeddings requires an external model call, which this
   * package (no I/O) can't do itself — the caller (the scoring service,
   * P4.3) supplies this the same way a Clock is injected for dates.
   * Defaults to a function that always returns 0 (no semantic bonus).
   */
  detailSimilarity?: (viewerDetail: string, candidateDetail: string) => number;
  /**
   * cofounderComplementarity(v, c) from §11.5.3 (subscores/skills.ts) —
   * requires industry vectors and skill functional areas this function
   * doesn't have. The caller computes it once and passes it in. Defaults
   * to 1 (no adjustment) so behaviour degrades gracefully if omitted,
   * though production wiring (P4.3) must always supply it for any pair
   * that includes need_cofounder↔need_cofounder.
   */
  cofounderComplementarityScore?: number;
  /** archivedComplementarityExists(v, c) — a DB lookup. Defaults to false. */
  hasArchivedIntentOverlap?: boolean;
}

// PRD §11.5.2, translated faithfully including: best-pair dominance with a
// capped multi-pair bonus, the ×1.15 primary multiplier on each side, the
// semantic detail bonus, the co-founder special case, the
// intent-count normalisation (1/sqrt(n/3) once the candidate has more than
// 3 active intents — discourages intent spam), and the 0.15 archived-intent
// prior when nothing else matched.
export function intentScore(
  viewerIntents: readonly IntentRef[],
  candidateIntents: readonly IntentRef[],
  options: IntentScoreOptions = {},
): number {
  if (viewerIntents.length === 0 || candidateIntents.length === 0) return 0.0;

  const matrix = options.matrix ?? DEFAULT_COMPLEMENTARITY_MATRIX;
  const detailSimilarity = options.detailSimilarity ?? (() => 0);

  let best = 0.0;
  let nonZeroPairCount = 0;

  for (const iv of viewerIntents) {
    for (const ic of candidateIntents) {
      const weight = matrix[iv.type][ic.type];
      if (weight === 0) continue;
      nonZeroPairCount += 1;

      let pair = weight;
      if (iv.isPrimary) pair *= 1.15;
      if (ic.isPrimary) pair *= 1.15;

      if (iv.detail && ic.detail) {
        pair *= 1.0 + 0.15 * detailSimilarity(iv.detail, ic.detail);
      }

      if (iv.type === "need_cofounder" && ic.type === "need_cofounder") {
        pair *= options.cofounderComplementarityScore ?? 1;
      }

      pair = Math.min(pair, 1.0);
      best = Math.max(best, pair);
    }
  }

  // When no pair matched at all (nonZeroPairCount === 0), the pseudocode's
  // multi formula alone would go negative (0.05 × (0 − 1) = −0.05),
  // producing a negative raw score instead of the 0 the "archived-intent
  // prior" check below depends on seeing. Clamping to a 0 floor (not just
  // the pseudocode's stated 1.0 ceiling) keeps that check correct without
  // changing the result for any case where at least one pair matched.
  const multi = Math.min(0.15, 0.05 * (nonZeroPairCount - 1));
  let raw = clamp(best + multi, 0, 1.0);

  if (candidateIntents.length > 3) {
    raw *= 1 / Math.sqrt(Math.max(1, candidateIntents.length) / 3);
  }

  if (raw === 0 && options.hasArchivedIntentOverlap) {
    raw = 0.15;
  }

  return raw;
}
