import { describe, expect, it } from "vitest";
import { interestsScore } from "./interests";

describe("interestsScore", () => {
  it("blends jaccard overlap and cosine similarity 0.6/0.4", () => {
    const score = interestsScore({
      viewerInterests: ["hiking", "chess"],
      candidateInterests: ["chess", "cooking"],
      cosineSimilarity: 0.5,
    });
    // jaccard = 1/3 (shared: chess; union: hiking, chess, cooking)
    expect(score).toBeCloseTo(0.6 * (1 / 3) + 0.4 * 0.5, 5);
  });

  it("is case-insensitive", () => {
    const score = interestsScore({
      viewerInterests: ["Chess"],
      candidateInterests: ["chess"],
      cosineSimilarity: 0,
    });
    expect(score).toBeCloseTo(0.6 * 1, 5);
  });

  it("returns 0 overlap contribution when both interest lists are empty", () => {
    const score = interestsScore({
      viewerInterests: [],
      candidateInterests: [],
      cosineSimilarity: 0.2,
    });
    expect(score).toBeCloseTo(0.4 * 0.2, 5);
  });

  it("clamps the result to [0, 1]", () => {
    const score = interestsScore({
      viewerInterests: ["chess"],
      candidateInterests: ["chess"],
      cosineSimilarity: 1,
    });
    expect(score).toBeLessThanOrEqual(1);
  });
});
