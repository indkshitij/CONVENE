import { clamp } from "../types";

export type LocationTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RemotePreference = "onsite" | "hybrid" | "remote" | "any";

export interface LocationScoreInput {
  /**
   * Resolved by the caller (PostGIS distance/city/state/country lookups —
   * this package has no I/O), the same way availability's
   * scheduledOverlapMinutes is precomputed upstream.
   */
  tier: LocationTier;
  /** distance / selected-radius, in [0,1]. Required only for tier 1's linear decay. */
  tier1DistanceRatio?: number;
  isHiddenLocation?: boolean;
  bothRemotePreference?: boolean;
  candidateOpenToRelocateToViewerCity?: boolean;
  viewerRemotePreference: RemotePreference;
  timezoneOverlapHours?: number;
  candidateIsScheduledOnly?: boolean;
}

function tierBaseScore(tier: LocationTier, tier1DistanceRatio: number | undefined): number {
  switch (tier) {
    case 0:
      return 1.0;
    case 1: {
      // PRD §10.5.4: "within selected radius ... 0.95 → 0.80 (linear decay
      // by distance/radius)." 0.95 at ratio 0 (right at the viewer), 0.80
      // at ratio 1 (right at the radius edge).
      const ratio = clamp(tier1DistanceRatio ?? 0, 0, 1);
      return 0.95 - 0.15 * ratio;
    }
    case 2:
      return 0.78;
    case 3:
      return 0.58;
    case 4:
      return 0.4;
    case 5:
      return 0.28;
    case 6:
      return 0.12;
  }
}

// PRD §10.5.4, translated faithfully: the seven-tier base score, the
// hidden-location neutral score (0.35, replacing the tier value rather
// than gating it to 0), the two "Special" floors applied via max() on top
// of whatever tier score resulted, then the remote/onsite viewer-
// preference modifiers, then the scheduled-only timezone penalty.
export function locationScore(input: LocationScoreInput): number {
  let tierScore = input.isHiddenLocation
    ? 0.35
    : tierBaseScore(input.tier, input.tier1DistanceRatio);

  if (input.bothRemotePreference) {
    tierScore = Math.max(tierScore, 0.55);
  }
  if (input.candidateOpenToRelocateToViewerCity) {
    tierScore = Math.max(tierScore, 0.7);
  }

  let score = tierScore;
  if (input.viewerRemotePreference === "remote") {
    score = 0.4 + 0.6 * score;
  } else if (input.viewerRemotePreference === "onsite") {
    score = Math.pow(score, 1.4);
  }

  if (
    input.timezoneOverlapHours !== undefined &&
    input.timezoneOverlapHours < 2 &&
    input.candidateIsScheduledOnly
  ) {
    score *= 0.75;
  }

  return clamp(score, 0, 1);
}
