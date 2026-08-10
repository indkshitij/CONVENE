import { describe, expect, it } from "vitest";
import { getIntentLimit } from "./plan-limits";

// BR-INT-02 verbatim.
describe("getIntentLimit", () => {
  it.each([
    ["free", 3],
    ["premium", 8],
    ["pro", 12],
    ["enterprise", 14],
  ])("%s -> %i", (plan, expected) => {
    expect(getIntentLimit(plan)).toBe(expected);
  });

  it("falls back to the free limit for an unrecognised plan code", () => {
    expect(getIntentLimit("nonexistent")).toBe(3);
  });
});
