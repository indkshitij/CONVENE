import { describe, expect, it } from "vitest";
import {
  ANANYA_MEERA_EXPECTED_SCORE,
  ANANYA_MEERA_EXPECTED_WEIGHTED_SUM,
  ANANYA_MEERA_MULTIPLIER,
  ANANYA_MEERA_SUB_SCORES,
} from "./__fixtures__/ananya-meera";
import { type SubScores, computeScore, renormaliseWeights } from "./score";
import { DEFAULT_WEIGHTS } from "./weights";

describe("computeScore", () => {
  // PRD §11.6's own worked example, used as a direct acceptance fixture:
  // "Ananya x Meera must produce weighted sum 0.7152 and final score 79."
  it("reproduces the §11.6 worked example to the documented precision", () => {
    const result = computeScore(ANANYA_MEERA_SUB_SCORES, ANANYA_MEERA_MULTIPLIER);
    expect(result.weightedSum).toBeCloseTo(ANANYA_MEERA_EXPECTED_WEIGHTED_SUM, 4);
    expect(result.score).toBe(ANANYA_MEERA_EXPECTED_SCORE);
  });

  it("computes 100 x weightedSum x multiplier, rounded, when all sub-scores are present", () => {
    const subScores: SubScores = {
      avail: 1,
      intent: 1,
      loc: 1,
      skill: 1,
      industry: 1,
      exp: 1,
      interest: 1,
      mutual: 1,
      activity: 1,
      rep: 1,
      lang: 1,
    };
    const result = computeScore(subScores, 1.0);
    expect(result.weightedSum).toBeCloseTo(1.0, 5);
    expect(result.score).toBe(100);
  });

  it("clamps the score at 100 even if the multiplier pushes it over", () => {
    const subScores: SubScores = { avail: 1, intent: 1 };
    const result = computeScore(subScores, 1.15);
    expect(result.score).toBe(100);
  });

  it("clamps the score at 0 for all-zero sub-scores", () => {
    const subScores: SubScores = { avail: 0, intent: 0 };
    const result = computeScore(subScores, 1.0);
    expect(result.score).toBe(0);
  });

  it("returns 0 for both weightedSum and score when no sub-scores are supplied", () => {
    const result = computeScore({}, 1.0);
    expect(result.weightedSum).toBe(0);
    expect(result.score).toBe(0);
  });

  it("renormalises weights when a sub-score is unavailable (cold-start safe)", () => {
    // Only avail (0.22) and intent (0.24) available -> renormalised to
    // 0.22/0.46 and 0.24/0.46 respectively, summing to 1.0 between them.
    const subScores: SubScores = { avail: 0.5, intent: 0.5 };
    const result = computeScore(subScores, 1.0);
    const expectedWeightedSum = (0.22 / 0.46) * 0.5 + (0.24 / 0.46) * 0.5;
    expect(result.weightedSum).toBeCloseTo(expectedWeightedSum, 5);
  });

  it("uses DEFAULT_WEIGHTS when no weights argument is supplied", () => {
    const result = computeScore({ avail: 1 }, 1.0);
    expect(result.weightedSum).toBeCloseTo(1.0, 5);
  });

  it("treats a 0-weighted available sub-score as contributing nothing (renormaliseWeights returns {} when the available weights sum to 0)", () => {
    const result = computeScore({ avail: 0.9 }, 1.0, { ...DEFAULT_WEIGHTS, avail: 0 });
    expect(result.weightedSum).toBe(0);
  });
});

describe("renormaliseWeights", () => {
  it("returns weights proportional to the available subset", () => {
    const renormalised = renormaliseWeights(DEFAULT_WEIGHTS, ["avail", "intent"]);
    const sum = (renormalised.avail ?? 0) + (renormalised.intent ?? 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("returns an empty object when no keys are available", () => {
    expect(renormaliseWeights(DEFAULT_WEIGHTS, [])).toEqual({});
  });

  it("leaves a full set of weights unchanged (already sums to 1.00)", () => {
    const allKeys = Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[];
    const renormalised = renormaliseWeights(DEFAULT_WEIGHTS, allKeys);
    for (const key of allKeys) {
      expect(renormalised[key]).toBeCloseTo(DEFAULT_WEIGHTS[key], 9);
    }
  });
});
