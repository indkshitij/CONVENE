import { type AvailabilityState, type Clock, clamp, systemClock } from "../types";

export interface AvailabilityScoreCandidate {
  state: AvailabilityState;
  /** Required when state === "available_now". */
  expiresAt?: Date;
  /** Required when state === "offline". */
  lastSeenAt?: Date;
  /**
   * Required when state === "scheduled". Timezone-normalised overlap
   * between the viewer's windows and the candidate's next window, in
   * minutes — computed upstream (this package has no I/O and doesn't do
   * timezone arithmetic itself).
   */
  scheduledOverlapMinutes?: number;
  /** Required when state === "scheduled". */
  nextWindowStartsAt?: Date;
}

// PRD §11.5.1. The pseudocode's available_now branch ends with
// `if v.availability_state == 'available_now': base = min(1.00, base × 1.00)`
// annotated "# already max" in the PRD itself — multiplying by 1.00 and
// re-clamping to a ceiling the value can never exceed (the preceding
// clamp() already bounds it to [0.80, 1.00]) is a mathematical no-op
// regardless of the viewer's state, so it isn't implemented as a real
// branch here; a viewer parameter would add surface area with no
// behavioural effect.
export function availabilityScore(
  candidate: AvailabilityScoreCandidate,
  clock: Clock = systemClock,
): number {
  const now = clock.now();

  switch (candidate.state) {
    case "available_now": {
      if (!candidate.expiresAt) {
        throw new Error("availabilityScore: available_now requires expiresAt");
      }
      const remainingMinutes = (candidate.expiresAt.getTime() - now.getTime()) / 60_000;
      return clamp(0.8 + (0.2 * Math.min(remainingMinutes, 60)) / 60, 0.8, 1.0);
    }
    case "scheduled": {
      if (
        candidate.scheduledOverlapMinutes !== undefined &&
        candidate.scheduledOverlapMinutes >= 15
      ) {
        return 0.65;
      }
      if (candidate.nextWindowStartsAt !== undefined) {
        const hoursUntil = (candidate.nextWindowStartsAt.getTime() - now.getTime()) / 3_600_000;
        if (hoursUntil <= 48) return 0.55;
      }
      return 0.45;
    }
    case "busy":
      return 0.4;
    case "away":
      return 0.25;
    case "offline": {
      if (!candidate.lastSeenAt) {
        throw new Error("availabilityScore: offline requires lastSeenAt");
      }
      const hours = (now.getTime() - candidate.lastSeenAt.getTime()) / 3_600_000;
      if (hours < 6) return 0.22;
      if (hours < 24) return 0.16;
      if (hours < 168) return 0.1;
      return 0.05;
    }
    case "invisible":
      return 0.0;
  }
}
