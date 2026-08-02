// PRD §11.3 — launch-default weights for the 11 sub-scores. "Tunable
// without deploys: all weights ... live in remote config" (§11.1) — this
// is the seed/fallback set, not the live source of truth; the live
// weights are loaded from remote config by the scoring service (P4.3) and
// only fall back to this object if that lookup fails.
export interface MatchingWeights {
  avail: number;
  intent: number;
  loc: number;
  skill: number;
  industry: number;
  exp: number;
  interest: number;
  mutual: number;
  activity: number;
  rep: number;
  lang: number;
}

export const DEFAULT_WEIGHTS: MatchingWeights = {
  avail: 0.22,
  intent: 0.24,
  loc: 0.16,
  skill: 0.12,
  industry: 0.05,
  exp: 0.05,
  interest: 0.04,
  mutual: 0.05,
  activity: 0.03,
  rep: 0.02,
  lang: 0.02,
};

const WEIGHT_SUM_TOLERANCE = 1e-9;

export function assertWeightsSumToOne(weights: MatchingWeights): void {
  const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
  if (Math.abs(sum - 1.0) > WEIGHT_SUM_TOLERANCE) {
    throw new Error(`Matching weights must sum to 1.00, got ${sum}`);
  }
}

// Asserted at module load (P4.2 acceptance) so a bad edit to
// DEFAULT_WEIGHTS fails immediately, not silently at scoring time.
assertWeightsSumToOne(DEFAULT_WEIGHTS);
