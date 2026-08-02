import { clamp } from "../types";

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a.map((item) => item.toLowerCase()));
  const setB = new Set(b.map((item) => item.toLowerCase()));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  return intersection / union.size;
}

export interface InterestsScoreInput {
  viewerInterests: readonly string[];
  candidateInterests: readonly string[];
  /** cosine(interestVec(v), interestVec(c)) — requires embeddings, injected. */
  cosineSimilarity: number;
}

// PRD §11.5.4.
export function interestsScore(input: InterestsScoreInput): number {
  const overlap = jaccard(input.viewerInterests, input.candidateInterests);
  return clamp(0.6 * overlap + 0.4 * input.cosineSimilarity, 0, 1);
}
