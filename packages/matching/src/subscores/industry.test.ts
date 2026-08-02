import { describe, expect, it } from "vitest";
import { industryScore } from "./industry";

describe("industryScore", () => {
  // PRD §11.6 worked example: "Same industry" -> 1.00.
  it("returns 1.00 for the same industry", () => {
    expect(industryScore({ sameIndustry: true })).toBe(1.0);
  });

  it("returns the injected adjacency value for different industries", () => {
    expect(industryScore({ sameIndustry: false, adjacencyValue: 0.3 })).toBe(0.3);
  });

  it("throws when industries differ and no adjacency value is supplied", () => {
    expect(() => industryScore({ sameIndustry: false })).toThrow(/adjacencyValue/);
  });

  it("floors the adjacency value at 0.45 for hiring/job intent families", () => {
    const score = industryScore({
      sameIndustry: false,
      adjacencyValue: 0.2,
      isHiringOrJobIntentFamily: true,
    });
    expect(score).toBe(0.45);
  });

  it("does not lower an adjacency value that already exceeds 0.45, even for hiring/job", () => {
    const score = industryScore({
      sameIndustry: false,
      adjacencyValue: 0.6,
      isHiringOrJobIntentFamily: true,
    });
    expect(score).toBe(0.6);
  });

  it("does not apply the floor outside the hiring/job family", () => {
    const score = industryScore({
      sameIndustry: false,
      adjacencyValue: 0.2,
      isHiringOrJobIntentFamily: false,
    });
    expect(score).toBe(0.2);
  });
});
