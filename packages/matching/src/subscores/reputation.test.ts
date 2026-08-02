import { describe, expect, it } from "vitest";
import { reputationScore } from "./reputation";

describe("reputationScore", () => {
  // PRD §11.6 worked example: reputation 88 -> s_rep = 0.88.
  it("matches the §11.6 worked example", () => {
    expect(reputationScore(88)).toBeCloseTo(0.88, 5);
  });

  it("returns 0 for a reputation score of 0", () => {
    expect(reputationScore(0)).toBe(0);
  });

  it("returns 1.0 for a reputation score of 100", () => {
    expect(reputationScore(100)).toBe(1.0);
  });
});
