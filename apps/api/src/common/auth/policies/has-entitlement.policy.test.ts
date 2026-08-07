import { describe, expect, it } from "vitest";
import { hasEntitlement } from "./has-entitlement.policy";

describe("hasEntitlement", () => {
  it("is true for a boolean entitlement set to true", () => {
    expect(hasEntitlement({ can_export: true }, "can_export")).toBe(true);
  });

  it("is false for a boolean entitlement set to false", () => {
    expect(hasEntitlement({ can_export: false }, "can_export")).toBe(false);
  });

  it("is true for a numeric quota greater than zero", () => {
    expect(hasEntitlement({ daily_requests: 5 }, "daily_requests")).toBe(true);
  });

  it("is false for a numeric quota of zero", () => {
    expect(hasEntitlement({ daily_requests: 0 }, "daily_requests")).toBe(false);
  });

  it("is false for a key that isn't present", () => {
    expect(hasEntitlement({}, "unknown_key")).toBe(false);
  });
});
