import { describe, expect, it } from "vitest";
import { isActiveMatch } from "./is-active-match.policy";

describe("isActiveMatch", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  it("is true when status is active and not yet expired", () => {
    expect(isActiveMatch("active", new Date("2026-08-03T13:00:00Z"), now)).toBe(true);
  });

  it("is false when status is not active", () => {
    expect(isActiveMatch("expired", new Date("2026-08-03T13:00:00Z"), now)).toBe(false);
  });

  it("is false when the expiry has already passed", () => {
    expect(isActiveMatch("active", new Date("2026-08-03T11:00:00Z"), now)).toBe(false);
  });

  it("is false exactly at the expiry instant", () => {
    expect(isActiveMatch("active", now, now)).toBe(false);
  });
});
