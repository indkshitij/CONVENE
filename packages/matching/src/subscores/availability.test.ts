import { describe, expect, it } from "vitest";
import type { Clock } from "../types";
import { availabilityScore } from "./availability";

const NOW = new Date("2026-08-02T12:00:00Z");
const fixedClock: Clock = { now: () => NOW };

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

describe("availabilityScore", () => {
  describe("available_now", () => {
    it("returns 1.00 when 60+ minutes remain (remaining capped at 60)", () => {
      const score = availabilityScore(
        { state: "available_now", expiresAt: minutesFromNow(120) },
        fixedClock,
      );
      expect(score).toBeCloseTo(1.0, 5);
    });

    it("returns exactly 1.00 at exactly 60 minutes remaining", () => {
      const score = availabilityScore(
        { state: "available_now", expiresAt: minutesFromNow(60) },
        fixedClock,
      );
      expect(score).toBeCloseTo(1.0, 5);
    });

    it("returns a proportional value for 28 minutes remaining", () => {
      const score = availabilityScore(
        { state: "available_now", expiresAt: minutesFromNow(28) },
        fixedClock,
      );
      expect(score).toBeCloseTo(0.8 + (0.2 * 28) / 60, 5);
    });

    it("floors at 0.80 when expiry has already passed", () => {
      const score = availabilityScore(
        { state: "available_now", expiresAt: minutesFromNow(-5) },
        fixedClock,
      );
      expect(score).toBeCloseTo(0.8, 5);
    });

    it("throws when expiresAt is missing", () => {
      expect(() => availabilityScore({ state: "available_now" }, fixedClock)).toThrow(/expiresAt/);
    });
  });

  describe("scheduled", () => {
    it("returns 0.65 when overlap is >= 15 minutes (the §11.6 worked example: Meera)", () => {
      const score = availabilityScore(
        {
          state: "scheduled",
          scheduledOverlapMinutes: 45,
          nextWindowStartsAt: minutesFromNow(60 * 22),
        },
        fixedClock,
      );
      expect(score).toBe(0.65);
    });

    it("returns 0.65 at exactly 15 minutes overlap", () => {
      const score = availabilityScore(
        { state: "scheduled", scheduledOverlapMinutes: 15 },
        fixedClock,
      );
      expect(score).toBe(0.65);
    });

    it("returns 0.55 when overlap is under 15 but the window starts within 48h", () => {
      const score = availabilityScore(
        {
          state: "scheduled",
          scheduledOverlapMinutes: 5,
          nextWindowStartsAt: minutesFromNow(60 * 22),
        },
        fixedClock,
      );
      expect(score).toBe(0.55);
    });

    it("returns 0.55 at exactly 48h out", () => {
      const score = availabilityScore(
        { state: "scheduled", nextWindowStartsAt: minutesFromNow(60 * 48) },
        fixedClock,
      );
      expect(score).toBe(0.55);
    });

    it("returns 0.45 when overlap is under 15 and the window is more than 48h out", () => {
      const score = availabilityScore(
        {
          state: "scheduled",
          scheduledOverlapMinutes: 5,
          nextWindowStartsAt: minutesFromNow(60 * 72),
        },
        fixedClock,
      );
      expect(score).toBe(0.45);
    });

    it("returns 0.45 when neither overlap nor next-window data is available", () => {
      const score = availabilityScore({ state: "scheduled" }, fixedClock);
      expect(score).toBe(0.45);
    });
  });

  it("returns 0.40 for busy", () => {
    expect(availabilityScore({ state: "busy" }, fixedClock)).toBe(0.4);
  });

  it("returns 0.25 for away", () => {
    expect(availabilityScore({ state: "away" }, fixedClock)).toBe(0.25);
  });

  describe("offline", () => {
    it("returns 0.22 under 6 hours", () => {
      expect(availabilityScore({ state: "offline", lastSeenAt: hoursAgo(3) }, fixedClock)).toBe(
        0.22,
      );
    });

    it("returns 0.16 between 6 and 24 hours", () => {
      expect(availabilityScore({ state: "offline", lastSeenAt: hoursAgo(12) }, fixedClock)).toBe(
        0.16,
      );
    });

    it("returns 0.10 between 24 and 168 hours", () => {
      expect(availabilityScore({ state: "offline", lastSeenAt: hoursAgo(100) }, fixedClock)).toBe(
        0.1,
      );
    });

    it("returns 0.05 at or beyond 168 hours", () => {
      expect(availabilityScore({ state: "offline", lastSeenAt: hoursAgo(200) }, fixedClock)).toBe(
        0.05,
      );
    });

    it("throws when lastSeenAt is missing", () => {
      expect(() => availabilityScore({ state: "offline" }, fixedClock)).toThrow(/lastSeenAt/);
    });
  });

  it("returns 0.00 for invisible", () => {
    expect(availabilityScore({ state: "invisible" }, fixedClock)).toBe(0.0);
  });
});
