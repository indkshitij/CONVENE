import { describe, expect, it } from "vitest";
import { isNotBlocked } from "./is-not-blocked.policy";

describe("isNotBlocked", () => {
  it("is true when the target is not in the blocked list", () => {
    expect(isNotBlocked(["user-1"], "user-2")).toBe(true);
  });

  it("is false when the target is in the blocked list", () => {
    expect(isNotBlocked(["user-1", "user-2"], "user-2")).toBe(false);
  });

  it("is true for an empty blocked list", () => {
    expect(isNotBlocked([], "user-2")).toBe(true);
  });
});
