import type { IntentFamily } from "../types";

export interface SeniorityRange {
  min: number;
  max: number;
}

export interface ExperienceScoreInput {
  viewerYearsExperience: number;
  candidateYearsExperience: number;
  intentFamily: IntentFamily;
  /** Required for the hiring family — intent.metadata.seniority_range. */
  seniorityRange?: SeniorityRange;
}

const EXPERIENCE_FLOOR = 0.1;

function gaussian(distance: number, ideal: number, tolerance: number): number {
  return Math.exp(-((distance - ideal) ** 2) / (2 * tolerance ** 2));
}

// PRD §11.5.4, translated faithfully: per-family ideal/tolerance Gaussian,
// with the 0.10 floor guardrail ("experience must not become a caste
// system") applied uniformly across every family.
//
// The pseudocode's switch doesn't list a bucket for the "learning" family
// specifically — only mentorship_seeking/offering, "peer/coffee/
// networking/ai_collab", cofounder, and hiring are named. This maps
// "learning" into the same ideal=0/tolerance=5 bucket as peer/ai_collab,
// the closest documented fit; flagged as an interpretation, not a
// transcription.
//
// For the hiring family, the PRD says only "1.0 inside range, decay
// outside" without specifying the decay's shape. This reuses the Gaussian
// with tolerance=6 (the same tolerance as the mentorship families) applied
// to the candidate's distance from the nearest range boundary — a
// documented assumption, not a transcription.
export function experienceScore(input: ExperienceScoreInput): number {
  const d = input.candidateYearsExperience - input.viewerYearsExperience;
  let raw: number;

  switch (input.intentFamily) {
    case "mentorship_seeking":
      raw = gaussian(d, 6, 6);
      break;
    case "mentorship_offering":
      raw = gaussian(d, -6, 6);
      break;
    case "cofounder":
      raw = gaussian(d, 0, 7);
      break;
    case "hiring": {
      if (!input.seniorityRange) {
        throw new Error("experienceScore: the hiring family requires seniorityRange");
      }
      const { min, max } = input.seniorityRange;
      if (input.candidateYearsExperience >= min && input.candidateYearsExperience <= max) {
        raw = 1.0;
      } else {
        const distanceFromRange =
          input.candidateYearsExperience < min
            ? min - input.candidateYearsExperience
            : input.candidateYearsExperience - max;
        raw = gaussian(distanceFromRange, 0, 6);
      }
      break;
    }
    case "ai_collaboration":
    case "learning":
    case "peer":
      raw = gaussian(d, 0, 5);
      break;
  }

  return Math.max(EXPERIENCE_FLOOR, raw);
}
