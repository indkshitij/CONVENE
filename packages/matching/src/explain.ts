import { computeScore, renormaliseWeights, type SubScoreKey, type SubScores } from "./score";
import { DEFAULT_WEIGHTS, type MatchingWeights } from "./weights";

export interface ScoreContribution {
  key: SubScoreKey;
  weight: number;
  subScore: number;
  /** Integer contribution to the final score — every ScoreExplanation's contributions sum to exactly `score`. */
  contribution: number;
}

export interface ScoreExplanation {
  score: number;
  contributions: ScoreContribution[];
}

// PRD §10.3's `/matches/{id}/explain` endpoint ("sub-score breakdown")
// plus its own testing bar ("assert explain sums to the returned score").
// computeScore() rounds once at the end (100 x weightedSum x multiplier);
// summing each component's own *unrounded* contribution and rounding
// independently would drift from that single rounded total by up to a
// few points across 11 components. Instead: round every contribution
// normally, then push the accumulated rounding remainder onto whichever
// contribution is largest — a standard largest-remainder allocation, so
// contributions always sum to the exact integer already shown to the
// user, never a number that merely "rounds to" it.
export function explainScore(
  subScores: SubScores,
  multiplier: number,
  weights: MatchingWeights = DEFAULT_WEIGHTS,
): ScoreExplanation {
  const { score } = computeScore(subScores, multiplier, weights);

  const availableKeys = (Object.keys(subScores) as SubScoreKey[]).filter(
    (key) => subScores[key] !== undefined,
  );
  const renormalised = renormaliseWeights(weights, availableKeys);

  const contributions: ScoreContribution[] = availableKeys.map((key) => {
    const weight = renormalised[key] ?? 0;
    const subScore = subScores[key] as number;
    return {
      key,
      weight,
      subScore,
      contribution: Math.round(100 * weight * subScore * multiplier),
    };
  });

  if (contributions.length > 0) {
    const roundedSum = contributions.reduce((sum, c) => sum + c.contribution, 0);
    const remainder = score - roundedSum;
    if (remainder !== 0) {
      const largest = contributions.reduce((a, b) => (b.contribution > a.contribution ? b : a));
      largest.contribution += remainder;
    }
  }

  return { score, contributions };
}
