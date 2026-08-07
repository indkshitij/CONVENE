import { describe, expect, it } from "vitest";
import { computeYearsExperience, isOverrideSuspicious } from "./years-experience";

describe("computeYearsExperience", () => {
  const now = new Date("2026-08-03T00:00:00Z");

  it("returns 0 for no experience entries", () => {
    expect(computeYearsExperience([], now)).toBe(0);
  });

  it("computes a single non-overlapping range", () => {
    const years = computeYearsExperience([{ startDate: "2020-01-01", endDate: "2022-01-01" }], now);
    expect(years).toBeCloseTo(2, 1);
  });

  it("treats a null endDate (is_current) as running through now", () => {
    const years = computeYearsExperience([{ startDate: "2024-08-03", endDate: null }], now);
    expect(years).toBeCloseTo(2, 1);
  });

  it("sums two non-overlapping ranges", () => {
    const years = computeYearsExperience(
      [
        { startDate: "2018-01-01", endDate: "2020-01-01" },
        { startDate: "2020-01-01", endDate: "2022-01-01" },
      ],
      now,
    );
    expect(years).toBeCloseTo(4, 1);
  });

  it("merges overlapping ranges instead of double-counting (§10.2.12 edge case #1)", () => {
    const overlapping = computeYearsExperience(
      [
        { startDate: "2020-01-01", endDate: "2023-01-01" },
        { startDate: "2021-01-01", endDate: "2022-01-01" }, // fully inside the first
      ],
      now,
    );
    // Without merging this would be ~4 years (3 + 1); merged it's the
    // union's span, exactly 3.
    expect(overlapping).toBeCloseTo(3, 1);
  });

  it("merges partially-overlapping ranges by their union span", () => {
    const years = computeYearsExperience(
      [
        { startDate: "2020-01-01", endDate: "2021-06-01" },
        { startDate: "2021-01-01", endDate: "2022-01-01" },
      ],
      now,
    );
    // Union: 2020-01-01 -> 2022-01-01 = 2 years.
    expect(years).toBeCloseTo(2, 1);
  });

  it("never penalises a gap between roles (no subtraction for idle time)", () => {
    const years = computeYearsExperience(
      [
        { startDate: "2015-01-01", endDate: "2016-01-01" },
        { startDate: "2020-01-01", endDate: "2021-01-01" }, // 4-year gap
      ],
      now,
    );
    expect(years).toBeCloseTo(2, 1); // 1 + 1, the gap itself isn't counted either way
  });

  it("handles unsorted input identically to sorted input", () => {
    const unsorted = computeYearsExperience(
      [
        { startDate: "2020-01-01", endDate: "2021-01-01" },
        { startDate: "2015-01-01", endDate: "2016-01-01" },
      ],
      now,
    );
    expect(unsorted).toBeCloseTo(2, 1);
  });
});

describe("isOverrideSuspicious", () => {
  it("is false when the override is within 3 years of the derived value", () => {
    expect(isOverrideSuspicious(5, 8)).toBe(false);
  });

  it("is true when the override exceeds the derived value by more than 3 years", () => {
    expect(isOverrideSuspicious(5, 8.1)).toBe(true);
  });

  it("is false when the override is lower than the derived value", () => {
    expect(isOverrideSuspicious(10, 2)).toBe(false);
  });
});
