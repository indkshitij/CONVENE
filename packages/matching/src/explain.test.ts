import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ANANYA_MEERA_MULTIPLIER, ANANYA_MEERA_SUB_SCORES } from "./__fixtures__/ananya-meera";
import { explainScore } from "./explain";
import { computeScore, type SubScores } from "./score";

describe("explainScore", () => {
  it("the contributions sum to exactly the returned score for the §11.6 worked example", () => {
    const { score, contributions } = explainScore(ANANYA_MEERA_SUB_SCORES, ANANYA_MEERA_MULTIPLIER);
    const sum = contributions.reduce((total, c) => total + c.contribution, 0);
    expect(sum).toBe(score);
  });

  it("matches computeScore's own score for the same inputs", () => {
    const { score: expected } = computeScore(ANANYA_MEERA_SUB_SCORES, ANANYA_MEERA_MULTIPLIER);
    const { score } = explainScore(ANANYA_MEERA_SUB_SCORES, ANANYA_MEERA_MULTIPLIER);
    expect(score).toBe(expected);
  });

  it("includes one contribution per available sub-score key", () => {
    const { contributions } = explainScore(ANANYA_MEERA_SUB_SCORES, ANANYA_MEERA_MULTIPLIER);
    expect(contributions).toHaveLength(Object.keys(ANANYA_MEERA_SUB_SCORES).length);
  });

  it("still sums exactly for a cold-start renormalised subset (some sub-scores unavailable)", () => {
    const partial: SubScores = { intent: 0.9, loc: 0.4, industry: 1.0 };
    const { score, contributions } = explainScore(partial, 1.05);
    const sum = contributions.reduce((total, c) => total + c.contribution, 0);
    expect(sum).toBe(score);
    expect(contributions).toHaveLength(3);
  });

  it("property: contributions always sum to exactly the returned score, across random sub-score/multiplier combinations", () => {
    fc.assert(
      fc.property(
        fc.record({
          avail: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
          intent: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
          loc: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
          skill: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
        }),
        fc.float({ min: Math.fround(0.7), max: Math.fround(1.15), noNaN: true }),
        (subScores, multiplier) => {
          const { score, contributions } = explainScore(subScores, multiplier);
          const sum = contributions.reduce((total, c) => total + c.contribution, 0);
          expect(sum).toBe(score);
        },
      ),
    );
  });
});
