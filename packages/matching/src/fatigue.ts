import { clamp } from "./types";

// PRD §11.8: "m_fatigue = 1.00 (1-2 shows) -> 0.85 (3-4) -> 0.70 (5+)."
export function fatigueMultiplier(impressionCount: number): number {
  if (impressionCount <= 2) return 1.0;
  if (impressionCount <= 4) return 0.85;
  return clamp(0.7, 0.7, 1.0);
}

// PRD §11.8: "After 8 impressions with no interaction, suppress for 14
// days."
export const FATIGUE_SUPPRESSION_IMPRESSION_THRESHOLD = 8;
export const FATIGUE_SUPPRESSION_DAYS = 14;

export function shouldAutoSuppress(impressionCount: number, interacted: boolean): boolean {
  return !interacted && impressionCount >= FATIGUE_SUPPRESSION_IMPRESSION_THRESHOLD;
}
