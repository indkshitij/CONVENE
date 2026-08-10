import { describe, expect, it } from "vitest";
import {
  FATIGUE_SUPPRESSION_IMPRESSION_THRESHOLD,
  fatigueMultiplier,
  shouldAutoSuppress,
} from "./fatigue";

describe("fatigueMultiplier", () => {
  it("is 1.00 for 1-2 shows", () => {
    expect(fatigueMultiplier(1)).toBe(1.0);
    expect(fatigueMultiplier(2)).toBe(1.0);
  });

  it("is 0.85 for 3-4 shows", () => {
    expect(fatigueMultiplier(3)).toBe(0.85);
    expect(fatigueMultiplier(4)).toBe(0.85);
  });

  it("is 0.70 for 5 or more shows", () => {
    expect(fatigueMultiplier(5)).toBe(0.7);
    expect(fatigueMultiplier(50)).toBe(0.7);
  });
});

describe("shouldAutoSuppress", () => {
  it("suppresses at exactly the 8-impression threshold with no interaction", () => {
    expect(shouldAutoSuppress(FATIGUE_SUPPRESSION_IMPRESSION_THRESHOLD, false)).toBe(true);
  });

  it("does not suppress below the threshold", () => {
    expect(shouldAutoSuppress(FATIGUE_SUPPRESSION_IMPRESSION_THRESHOLD - 1, false)).toBe(false);
  });

  it("never suppresses once the viewer has interacted, regardless of count", () => {
    expect(shouldAutoSuppress(100, true)).toBe(false);
  });
});
