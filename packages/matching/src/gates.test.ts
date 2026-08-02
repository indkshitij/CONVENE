import { describe, expect, it } from "vitest";
import type { Clock } from "./types";
import { type GateContext, applyGates, checkIntentFloor } from "./gates";

const NOW = new Date("2026-08-02T12:00:00Z");
const fixedClock: Clock = { now: () => NOW };

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

const PASSING_CONTEXT: GateContext = {
  viewerId: "viewer-1",
  candidateId: "candidate-1",
  isBlockedEitherDirection: false,
  hasActiveSuppression: false,
  isConnectedOrPendingRequest: false,
  profileVisibility: "public",
  viewerIsMatch: false,
  accountStatus: "active",
  profileCompletion: 60,
  intentScore: 0.5,
  passesInboundFilter: true,
  availabilityState: "available_now",
  lastSessionAt: daysAgo(1),
};

describe("checkIntentFloor (G8, exported separately for connection-request re-verification)", () => {
  it("returns true (excluded) below the 0.20 floor", () => {
    expect(checkIntentFloor(0.19)).toBe(true);
  });

  it("returns false at exactly the floor", () => {
    expect(checkIntentFloor(0.2)).toBe(false);
  });

  it("returns false above the floor", () => {
    expect(checkIntentFloor(0.5)).toBe(false);
  });
});

describe("applyGates", () => {
  it("passes a candidate that fails no gate", () => {
    expect(applyGates(PASSING_CONTEXT, fixedClock)).toEqual({ excluded: false });
  });

  it("G1: excludes when viewer and candidate are the same id", () => {
    const result = applyGates({ ...PASSING_CONTEXT, candidateId: "viewer-1" }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G1_SELF" });
  });

  it("G2: excludes when blocked in either direction", () => {
    const result = applyGates({ ...PASSING_CONTEXT, isBlockedEitherDirection: true }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G2_BLOCK" });
  });

  it("G3: excludes on an active suppression", () => {
    const result = applyGates({ ...PASSING_CONTEXT, hasActiveSuppression: true }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G3_SUPPRESSION" });
  });

  it("G4: excludes when already connected or a request is pending", () => {
    const result = applyGates(
      { ...PASSING_CONTEXT, isConnectedOrPendingRequest: true },
      fixedClock,
    );
    expect(result).toEqual({ excluded: true, gate: "G4_RELATIONSHIP" });
  });

  it("G5: excludes a private profile", () => {
    const result = applyGates({ ...PASSING_CONTEXT, profileVisibility: "private" }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G5_VISIBILITY" });
  });

  it("G5: excludes matches_only when the viewer isn't a match", () => {
    const result = applyGates(
      { ...PASSING_CONTEXT, profileVisibility: "matches_only", viewerIsMatch: false },
      fixedClock,
    );
    expect(result).toEqual({ excluded: true, gate: "G5_VISIBILITY" });
  });

  it("G5: allows matches_only when the viewer is a match", () => {
    const result = applyGates(
      { ...PASSING_CONTEXT, profileVisibility: "matches_only", viewerIsMatch: true },
      fixedClock,
    );
    expect(result).toEqual({ excluded: false });
  });

  it("G5: excludes connections_only visibility", () => {
    const result = applyGates(
      { ...PASSING_CONTEXT, profileVisibility: "connections_only" },
      fixedClock,
    );
    expect(result).toEqual({ excluded: true, gate: "G5_VISIBILITY" });
  });

  it("G5: allows authenticated visibility", () => {
    const result = applyGates(
      { ...PASSING_CONTEXT, profileVisibility: "authenticated" },
      fixedClock,
    );
    expect(result).toEqual({ excluded: false });
  });

  it("G6: excludes a non-active account status", () => {
    const result = applyGates({ ...PASSING_CONTEXT, accountStatus: "suspended" }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G6_STATUS" });
  });

  it("G7: excludes profile_completion under 40", () => {
    const result = applyGates({ ...PASSING_CONTEXT, profileCompletion: 39 }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G7_COMPLETION" });
  });

  it("G8: excludes an intent score under the floor", () => {
    const result = applyGates({ ...PASSING_CONTEXT, intentScore: 0.1 }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G8_INTENT_FLOOR" });
  });

  it("G9: excludes when the viewer fails the candidate's inbound filter", () => {
    const result = applyGates({ ...PASSING_CONTEXT, passesInboundFilter: false }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G9_INBOUND_FILTER" });
  });

  it("G10: excludes an invisible candidate", () => {
    const result = applyGates({ ...PASSING_CONTEXT, availabilityState: "invisible" }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G10_INVISIBLE" });
  });

  it("G11: excludes while a cooldown is active", () => {
    const result = applyGates(
      { ...PASSING_CONTEXT, cooldownActiveUntil: new Date(NOW.getTime() + 60_000) },
      fixedClock,
    );
    expect(result).toEqual({ excluded: true, gate: "G11_COOLDOWN" });
  });

  it("G11: allows once the cooldown has expired", () => {
    const result = applyGates(
      { ...PASSING_CONTEXT, cooldownActiveUntil: new Date(NOW.getTime() - 60_000) },
      fixedClock,
    );
    expect(result).toEqual({ excluded: false });
  });

  it("G12: excludes a candidate with no session in 90+ days", () => {
    const result = applyGates({ ...PASSING_CONTEXT, lastSessionAt: daysAgo(90) }, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G12_DORMANT" });
  });

  it("G12: allows a candidate active within 90 days", () => {
    const result = applyGates({ ...PASSING_CONTEXT, lastSessionAt: daysAgo(89) }, fixedClock);
    expect(result).toEqual({ excluded: false });
  });

  it("G12: excludes a candidate with no lastSessionAt at all", () => {
    const { lastSessionAt: _omitted, ...rest } = PASSING_CONTEXT;
    const result = applyGates(rest, fixedClock);
    expect(result).toEqual({ excluded: true, gate: "G12_DORMANT" });
  });

  it("uses the system clock by default", () => {
    // Uses the real current time (not the fixture's fixed NOW) so this
    // stays correct indefinitely rather than only near the fixture's date.
    const result = applyGates({ ...PASSING_CONTEXT, lastSessionAt: new Date() });
    expect(result).toEqual({ excluded: false });
  });
});
