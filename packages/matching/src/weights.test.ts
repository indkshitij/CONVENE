import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, assertWeightsSumToOne, isValidWeights } from "./weights";

describe("DEFAULT_WEIGHTS", () => {
  it("sums to 1.00 (asserted at module load)", () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((total, weight) => total + weight, 0);
    expect(sum).toBeCloseTo(1.0, 9);
  });
});

describe("assertWeightsSumToOne", () => {
  it("does not throw for weights summing to 1.00", () => {
    expect(() => assertWeightsSumToOne(DEFAULT_WEIGHTS)).not.toThrow();
  });

  it("throws for weights that do not sum to 1.00", () => {
    expect(() => assertWeightsSumToOne({ ...DEFAULT_WEIGHTS, avail: 0.5 })).toThrow(
      /must sum to 1\.00/,
    );
  });
});

describe("isValidWeights", () => {
  it("is true for weights summing to 1.00", () => {
    expect(isValidWeights(DEFAULT_WEIGHTS)).toBe(true);
  });

  it("is false for weights that do not sum to 1.00", () => {
    expect(isValidWeights({ ...DEFAULT_WEIGHTS, avail: 0.5 })).toBe(false);
  });

  it("agrees with assertWeightsSumToOne on the same inputs", () => {
    const invalid = { ...DEFAULT_WEIGHTS, avail: 0.9 };
    expect(isValidWeights(invalid)).toBe(false);
    expect(() => assertWeightsSumToOne(invalid)).toThrow();
  });
});
