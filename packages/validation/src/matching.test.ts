import { describe, expect, it } from "vitest";
import {
  rollbackMatchingWeightsSchema,
  skipMatchSchema,
  updateMatchingWeightsSchema,
} from "./matching";

const validWeights = {
  avail: 0.22,
  intent: 0.24,
  loc: 0.16,
  skill: 0.12,
  industry: 0.05,
  exp: 0.05,
  interest: 0.04,
  mutual: 0.05,
  activity: 0.03,
  rep: 0.02,
  lang: 0.02,
  reason: "Testing.",
};

describe("skipMatchSchema", () => {
  it("accepts an empty body — reason is optional", () => {
    expect(skipMatchSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a short reason", () => {
    const result = skipMatchSchema.safeParse({ reason: "Not a fit right now" });
    expect(result.success).toBe(true);
  });

  it("rejects a reason over 200 characters", () => {
    const result = skipMatchSchema.safeParse({ reason: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects an empty-string reason (must be omitted, not blank)", () => {
    const result = skipMatchSchema.safeParse({ reason: "" });
    expect(result.success).toBe(false);
  });
});

describe("updateMatchingWeightsSchema", () => {
  it("accepts a full, well-formed set of weights", () => {
    expect(updateMatchingWeightsSchema.safeParse(validWeights).success).toBe(true);
  });

  it("does not itself enforce the weights sum to 1.00 (that's a service-layer check)", () => {
    // A shape-valid but sum-invalid payload should still pass Zod — the
    // DB-backed isValidWeights() check is what rejects it.
    const result = updateMatchingWeightsSchema.safeParse({ ...validWeights, avail: 0.9 });
    expect(result.success).toBe(true);
  });

  it("rejects a missing key", () => {
    const { lang: _lang, ...missingLang } = validWeights;
    expect(updateMatchingWeightsSchema.safeParse(missingLang).success).toBe(false);
  });

  it("rejects a weight outside [0,1]", () => {
    expect(updateMatchingWeightsSchema.safeParse({ ...validWeights, avail: 1.5 }).success).toBe(
      false,
    );
    expect(updateMatchingWeightsSchema.safeParse({ ...validWeights, avail: -0.1 }).success).toBe(
      false,
    );
  });

  // P26.2: "a mandatory change reason."
  it("rejects a missing reason", () => {
    const { reason: _reason, ...withoutReason } = validWeights;
    expect(updateMatchingWeightsSchema.safeParse(withoutReason).success).toBe(false);
  });

  it("rejects an empty-string reason (must be a real explanation, not blank)", () => {
    expect(updateMatchingWeightsSchema.safeParse({ ...validWeights, reason: "" }).success).toBe(
      false,
    );
    expect(updateMatchingWeightsSchema.safeParse({ ...validWeights, reason: "   " }).success).toBe(
      false,
    );
  });
});

describe("rollbackMatchingWeightsSchema", () => {
  it("accepts a non-empty reason", () => {
    expect(
      rollbackMatchingWeightsSchema.safeParse({ reason: "Reverting a regression." }).success,
    ).toBe(true);
  });

  it("rejects a missing or empty reason", () => {
    expect(rollbackMatchingWeightsSchema.safeParse({}).success).toBe(false);
    expect(rollbackMatchingWeightsSchema.safeParse({ reason: "" }).success).toBe(false);
  });
});
