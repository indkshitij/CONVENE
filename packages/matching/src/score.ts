import { type MatchingWeights, DEFAULT_WEIGHTS } from "./weights";
import { clamp } from "./types";

export type SubScoreKey = keyof MatchingWeights;
export type SubScores = Partial<Record<SubScoreKey, number>>;

// PRD §11.10 pseudocode: "weights = renormalise(cfg.weights,
// available_keys(s))" — cold-start safe: when a sub-score can't be
// computed (e.g. skills/industry not yet precomputed for a brand-new
// profile), its weight is redistributed proportionally across whichever
// sub-scores ARE available, rather than silently treating the missing
// one as 0.
export function renormaliseWeights(
  weights: MatchingWeights,
  availableKeys: readonly SubScoreKey[],
): Partial<MatchingWeights> {
  const availableSum = availableKeys.reduce((sum, key) => sum + weights[key], 0);
  if (availableSum === 0) return {};

  const renormalised: Partial<MatchingWeights> = {};
  for (const key of availableKeys) {
    renormalised[key] = weights[key] / availableSum;
  }
  return renormalised;
}

export interface ScoreResult {
  /** Σ(wᵢ·sᵢ) — before ×100 and before the multiplier. */
  weightedSum: number;
  /** 100 × weightedSum × multiplier, rounded to an integer and clamped [0, 100]. */
  score: number;
}

// PRD §11.2: "CompatibilityScore(v, c) = 100 × Σ(wᵢ × sᵢ(v, c)) ×
// Π(mⱼ(v, c)), rounded to integer, clamped [0, 100]." Hard gates run
// separately in gates.ts, strictly before this is ever called; the
// multiplier is applied strictly after the weighted sum, per §11.2's own
// stated ordering guarantee ("a Premium boost can never surface an
// irrelevant person — the gate already removed them").
export function computeScore(
  subScores: SubScores,
  multiplier: number,
  weights: MatchingWeights = DEFAULT_WEIGHTS,
): ScoreResult {
  const availableKeys = (Object.keys(subScores) as SubScoreKey[]).filter(
    (key) => subScores[key] !== undefined,
  );
  const renormalisedWeights = renormaliseWeights(weights, availableKeys);

  // subScores[key] is guaranteed defined here (availableKeys was already
  // filtered above); renormalisedWeights[key] is only ever absent when
  // renormaliseWeights returned {} entirely (every available weight was
  // 0), so `?? 0` there is a real, reachable fallback, not defensive
  // dead code.
  const weightedSum = availableKeys.reduce((sum, key) => {
    const weight = renormalisedWeights[key] ?? 0;
    const value = subScores[key] as number;
    return sum + weight * value;
  }, 0);

  const score = clamp(Math.round(100 * weightedSum * multiplier), 0, 100);
  return { weightedSum, score };
}
