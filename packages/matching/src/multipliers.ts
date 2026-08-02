import { clamp } from "./types";

// PRD §11.3 multiplier table.
export type VerificationLevel = "L0" | "L1" | "L2" | "L3" | "L4";
export type Plan = "free" | "premium" | "pro";

const VERIFICATION_MULTIPLIERS: Record<VerificationLevel, number> = {
  L0: 0.85,
  L1: 0.95,
  L2: 1.0,
  L3: 1.05,
  L4: 1.08,
};

const PLAN_MULTIPLIERS: Record<Plan, number> = {
  free: 1.0,
  premium: 1.1,
  pro: 1.15,
};

const STALE_MULTIPLIER = 0.8;
const STALE_THRESHOLD_DAYS = 21;
const CONVENE_HOURS_MULTIPLIER = 1.08;
const NEWBIE_MULTIPLIER = 1.12;

// PRD §11.3: "Diversity/fatigue: 0.70–1.00, condition: shown to this
// viewer ≥ 3 times without interaction." No formula is given for how the
// impression count maps to a specific value inside that range — only the
// bounds. Rather than inventing a decay curve, the already-computed
// multiplier is injected (like Clock/embeddings elsewhere in this
// package) and defensively clamped to the documented bounds here.
const FATIGUE_MIN = 0.7;
const FATIGUE_MAX = 1.0;

export interface MultiplierInput {
  verificationLevel: VerificationLevel;
  plan: Plan;
  candidateInactiveDays: number;
  bothInConveneHour: boolean;
  fatigueMultiplier: number;
  candidateIsNewbie: boolean;
}

// PRD §11.2: "Hard gates are applied before scoring; multipliers after the
// weighted sum" — this function computes Π(mⱼ) only; score.ts applies it
// strictly after the weighted sub-score sum, per that ordering guarantee.
export function computeMultiplier(input: MultiplierInput): number {
  let multiplier = 1;
  multiplier *= VERIFICATION_MULTIPLIERS[input.verificationLevel];
  multiplier *= PLAN_MULTIPLIERS[input.plan];
  if (input.candidateInactiveDays > STALE_THRESHOLD_DAYS) {
    multiplier *= STALE_MULTIPLIER;
  }
  multiplier *= clamp(input.fatigueMultiplier, FATIGUE_MIN, FATIGUE_MAX);
  if (input.bothInConveneHour) {
    multiplier *= CONVENE_HOURS_MULTIPLIER;
  }
  if (input.candidateIsNewbie) {
    multiplier *= NEWBIE_MULTIPLIER;
  }
  return multiplier;
}
