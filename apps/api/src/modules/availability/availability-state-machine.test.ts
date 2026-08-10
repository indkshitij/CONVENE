import { describe, expect, it } from "vitest";
import { canTransition } from "./availability-state-machine";

describe("canTransition (§10.3.3 state diagram)", () => {
  it.each([
    ["offline", "available_now", true],
    ["available_now", "busy", true],
    ["available_now", "away", true],
    ["available_now", "invisible", true],
    ["busy", "available_now", true],
    ["away", "available_now", true],
    ["invisible", "available_now", true],
  ] as const)("%s -> %s is %s", (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });

  // The diagram has no direct edge between the three "activated but not
  // available" states — each must return through AvailableNow first.
  it.each([
    ["busy", "away"],
    ["busy", "invisible"],
    ["away", "busy"],
    ["away", "invisible"],
    ["invisible", "busy"],
    ["invisible", "away"],
    ["offline", "busy"],
    ["offline", "away"],
    ["offline", "invisible"],
  ] as const)("%s -> %s is rejected (no direct edge in the diagram)", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});
