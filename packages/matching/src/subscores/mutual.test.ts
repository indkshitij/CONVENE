import { describe, expect, it } from "vitest";
import { mutualScore } from "./mutual";

describe("mutualScore", () => {
  it("returns 0 for 0 mutual connections", () => {
    expect(mutualScore(0)).toBe(0);
  });

  // PRD §11.6 worked example: 3 mutuals -> log1p(3)/log1p(8) ~= 0.63.
  it("matches the §11.6 worked example for 3 mutuals", () => {
    expect(mutualScore(3)).toBeCloseTo(0.6309, 3);
  });

  it("saturates at 1.0 for exactly 8 mutuals", () => {
    expect(mutualScore(8)).toBeCloseTo(1.0, 5);
  });

  it("never exceeds 1.0 beyond 8 mutuals", () => {
    expect(mutualScore(50)).toBeCloseTo(1.0, 5);
  });
});
