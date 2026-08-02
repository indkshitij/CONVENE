export interface IndustryScoreInput {
  sameIndustry: boolean;
  /**
   * ADJACENCY[v.industry][c.industry] — the PRD (§11.5.4) describes this
   * as a "seeded 28×28 matrix, 0.15–0.75" without giving its actual
   * values (unlike the intent complementarity matrix, which the PRD does
   * give in full). Since this package has no I/O and the PRD withholds
   * the seed data, the resolved value is injected by the caller rather
   * than invented here. Required whenever industries differ.
   */
  adjacencyValue?: number;
  /** BR exception: "for hiring/job intents, cross-industry is often desirable → floor 0.45." */
  isHiringOrJobIntentFamily?: boolean;
}

// PRD §11.5.4.
export function industryScore(input: IndustryScoreInput): number {
  if (input.sameIndustry) return 1.0;

  if (input.adjacencyValue === undefined) {
    throw new Error("industryScore: adjacencyValue is required when industries differ");
  }

  return input.isHiringOrJobIntentFamily
    ? Math.max(input.adjacencyValue, 0.45)
    : input.adjacencyValue;
}
