// PRD §11.11: "Record impressions with the expansion stage and score
// band" for the fairness audit query. No exact band boundaries are given
// anywhere in §11 — five bands are used here, the middle one (55-69)
// deliberately aligned with diversity.ts's own exploration-slot score
// range (55-70) so "was this impression an exploration pick" and "which
// score band was it in" describe the same population consistently.
export const SCORE_BANDS = ["0-39", "40-54", "55-69", "70-84", "85-100"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export function scoreBand(score: number): ScoreBand {
  if (score < 40) return "0-39";
  if (score < 55) return "40-54";
  if (score < 70) return "55-69";
  if (score < 85) return "70-84";
  return "85-100";
}
