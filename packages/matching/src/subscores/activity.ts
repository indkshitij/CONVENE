import { clamp } from "../types";

export interface ActivityScoreInput {
  /** Distinct active days in the last 14 (§11.5.4). */
  activeDaysLast14: number;
  /** Availability sessions started in the last 14 days (§11.5.4). */
  availabilitySessionsLast14: number;
}

// PRD §11.5.4.
export function activityScore(input: ActivityScoreInput): number {
  return clamp(
    (0.5 * Math.min(input.activeDaysLast14, 10)) / 10 +
      (0.5 * Math.min(input.availabilitySessionsLast14, 6)) / 6,
    0,
    1,
  );
}
