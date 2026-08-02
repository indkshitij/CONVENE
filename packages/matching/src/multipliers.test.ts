import { describe, expect, it } from "vitest";
import { type MultiplierInput, computeMultiplier } from "./multipliers";

const BASE: MultiplierInput = {
  verificationLevel: "L2",
  plan: "free",
  candidateInactiveDays: 0,
  bothInConveneHour: false,
  fatigueMultiplier: 1.0,
  candidateIsNewbie: false,
};

describe("computeMultiplier", () => {
  it("returns 1.0 for the neutral baseline (L2, free, active, no fatigue/hours/newbie)", () => {
    expect(computeMultiplier(BASE)).toBeCloseTo(1.0, 5);
  });

  it.each([
    ["L0", 0.85],
    ["L1", 0.95],
    ["L2", 1.0],
    ["L3", 1.05],
    ["L4", 1.08],
  ] as const)("applies the %s verification multiplier", (level, expected) => {
    expect(computeMultiplier({ ...BASE, verificationLevel: level })).toBeCloseTo(expected, 5);
  });

  it.each([
    ["free", 1.0],
    ["premium", 1.1],
    ["pro", 1.15],
  ] as const)("applies the %s plan multiplier", (plan, expected) => {
    expect(computeMultiplier({ ...BASE, plan })).toBeCloseTo(expected, 5);
  });

  it("applies the 0.80 staleness penalty when inactive more than 21 days", () => {
    expect(computeMultiplier({ ...BASE, candidateInactiveDays: 22 })).toBeCloseTo(0.8, 5);
  });

  it("does not apply the staleness penalty at exactly 21 days", () => {
    expect(computeMultiplier({ ...BASE, candidateInactiveDays: 21 })).toBeCloseTo(1.0, 5);
  });

  it("applies the fatigue multiplier as given within bounds", () => {
    expect(computeMultiplier({ ...BASE, fatigueMultiplier: 0.8 })).toBeCloseTo(0.8, 5);
  });

  it("clamps a fatigue multiplier below the documented floor", () => {
    expect(computeMultiplier({ ...BASE, fatigueMultiplier: 0.5 })).toBeCloseTo(0.7, 5);
  });

  it("clamps a fatigue multiplier above the documented ceiling", () => {
    expect(computeMultiplier({ ...BASE, fatigueMultiplier: 1.5 })).toBeCloseTo(1.0, 5);
  });

  it("applies the 1.08 Convene Hours multiplier when both are participating", () => {
    expect(computeMultiplier({ ...BASE, bothInConveneHour: true })).toBeCloseTo(1.08, 5);
  });

  it("applies the 1.12 cold-start boost for a newbie candidate", () => {
    expect(computeMultiplier({ ...BASE, candidateIsNewbie: true })).toBeCloseTo(1.12, 5);
  });

  // PRD §11.6's own prose states "m_verify (L3) = 1.00", but §11.3's
  // multiplier table maps L3 -> 1.05 (L0..L4 = 0.85/0.95/1.00/1.05/1.08),
  // not 1.00 — a real inconsistency between the table and the worked
  // example, on top of the s_skill/s_lang/reason-ranking ones already
  // flagged elsewhere in this package. computeMultiplier here follows
  // §11.3's table (the explicitly cited source for this file), so L3
  // composed with Premium is 1.05 x 1.10 = 1.155, NOT the 1.10 the worked
  // example's prose implies. The worked-example score test in
  // score.test.ts uses the example's literal stated multiplier (1.10)
  // directly rather than deriving it through this lookup, precisely
  // because of this discrepancy.
  it("composes L3 verification with Premium per §11.3's table (1.05 x 1.10, not the worked example's stated 1.00 x 1.10)", () => {
    const multiplier = computeMultiplier({
      verificationLevel: "L3",
      plan: "premium",
      candidateInactiveDays: 0,
      bothInConveneHour: false,
      fatigueMultiplier: 1.0,
      candidateIsNewbie: false,
    });
    expect(multiplier).toBeCloseTo(1.05 * 1.1, 5);
  });

  it("composes every multiplier together when all conditions are active", () => {
    const multiplier = computeMultiplier({
      verificationLevel: "L4",
      plan: "pro",
      candidateInactiveDays: 30,
      bothInConveneHour: true,
      fatigueMultiplier: 0.9,
      candidateIsNewbie: true,
    });
    const expected = 1.08 * 1.15 * 0.8 * 0.9 * 1.08 * 1.12;
    expect(multiplier).toBeCloseTo(expected, 5);
  });
});
