import { describe, expect, it } from "vitest";
import {
  computeOverlapMinutes,
  isScheduleCompatible,
  materializeOccurrences,
  type RecurrenceRule,
} from "./schedule-recurrence";

// Renders a UTC instant as its local wall-clock time in the given IANA
// zone (HH:mm) — the assertion tool for "did the declared local time
// survive a DST transition."
function localTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

describe("materializeOccurrences — DST correctness (P10.3's own acceptance criterion)", () => {
  const weeklyThursday: RecurrenceRule = { freq: "WEEKLY", byDay: ["TH"] };

  it("a 6pm Thursday America/New_York window stays 6pm local across the spring-forward boundary (2027-03-14)", () => {
    // Thursday 2027-03-04, 18:00 EST (UTC-5) — three weeks before the
    // 2027-03-14 spring-forward transition.
    const startAt = new Date("2027-03-04T23:00:00.000Z"); // 18:00 EST
    const occurrences = materializeOccurrences(
      startAt,
      "America/New_York",
      weeklyThursday,
      6,
      startAt,
    );

    expect(occurrences.length).toBeGreaterThanOrEqual(4);
    for (const occurrence of occurrences) {
      expect(localTime(occurrence, "America/New_York")).toBe("18:00");
    }

    // The occurrence after the transition must have shifted to UTC-4
    // (EDT) — i.e. its UTC instant is 17:00 UTC, not 18:00 UTC — proving
    // the offset was actually re-resolved per-occurrence rather than a
    // fixed 7-day duration reused throughout.
    const afterTransition = occurrences.find(
      (o) => o.getTime() > new Date("2027-03-14T12:00:00Z").getTime(),
    );
    expect(afterTransition).toBeDefined();
    expect(afterTransition!.getUTCHours()).toBe(22); // 18:00 EDT = 22:00 UTC
  });

  it("a 6pm Thursday America/New_York window stays 6pm local across the autumn-back boundary (2026-11-01)", () => {
    // Thursday 2026-10-22, 18:00 EDT (UTC-4) — 10 days before the
    // 2026-11-01 autumn-back transition.
    const startAt = new Date("2026-10-22T22:00:00.000Z"); // 18:00 EDT
    const occurrences = materializeOccurrences(
      startAt,
      "America/New_York",
      weeklyThursday,
      4,
      startAt,
    );

    for (const occurrence of occurrences) {
      expect(localTime(occurrence, "America/New_York")).toBe("18:00");
    }

    const afterTransition = occurrences.find(
      (o) => o.getTime() > new Date("2026-11-01T12:00:00Z").getTime(),
    );
    expect(afterTransition).toBeDefined();
    expect(afterTransition!.getUTCHours()).toBe(23); // 18:00 EST = 23:00 UTC
  });

  it("Asia/Kolkata (no DST) is unaffected — every occurrence keeps the identical UTC offset", () => {
    // Thursday 18:00 IST (UTC+5:30) spanning both the US DST boundaries
    // above, in a zone that has none of its own.
    const startAt = new Date("2026-10-22T12:30:00.000Z"); // 18:00 IST
    const occurrences = materializeOccurrences(
      startAt,
      "Asia/Kolkata",
      weeklyThursday,
      12,
      startAt,
    );

    for (const occurrence of occurrences) {
      expect(localTime(occurrence, "Asia/Kolkata")).toBe("18:00");
      // 18:00 IST is always 12:30 UTC — no offset ever shifts.
      expect(occurrence.getUTCHours()).toBe(12);
      expect(occurrence.getUTCMinutes()).toBe(30);
    }
  });

  it("respects the count limit as a lifetime total, not a future-only count", () => {
    const startAt = new Date("2026-08-06T12:00:00.000Z"); // a Thursday
    const rule: RecurrenceRule = { freq: "WEEKLY", byDay: ["TH"], count: 3 };
    // "now" set two weeks after start, so only 1 of the 3 lifetime
    // occurrences is still upcoming.
    const now = new Date("2026-08-20T00:00:00.000Z");
    const occurrences = materializeOccurrences(startAt, "Asia/Kolkata", rule, 10, now);
    expect(occurrences).toHaveLength(1);
  });

  it("respects an until_at bound", () => {
    const startAt = new Date("2026-08-06T12:00:00.000Z");
    const rule: RecurrenceRule = {
      freq: "WEEKLY",
      byDay: ["TH"],
      until: new Date("2026-08-21T00:00:00.000Z"),
    };
    const occurrences = materializeOccurrences(startAt, "Asia/Kolkata", rule, 10, startAt);
    // Weeks of 08-06, 08-13, 08-20 fall on/before the until date; 08-27 does not.
    expect(occurrences).toHaveLength(3);
  });

  it("a one-off (no rule) returns only the start_at instant, and only while upcoming", () => {
    const startAt = new Date("2026-09-01T10:00:00.000Z");
    expect(
      materializeOccurrences(
        startAt,
        "Asia/Kolkata",
        null,
        5,
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).toEqual([startAt]);
    expect(
      materializeOccurrences(
        startAt,
        "Asia/Kolkata",
        null,
        5,
        new Date("2026-10-01T00:00:00.000Z"),
      ),
    ).toEqual([]);
  });
});

describe("computeOverlapMinutes / isScheduleCompatible (BR-AVAIL-17)", () => {
  it("two windows overlapping by exactly 15 minutes after UTC normalisation are compatible (BR-AVAIL-17's own threshold)", () => {
    // A: 12:30-13:15 UTC. B: 13:00-14:00 UTC. Overlap = 13:15-13:00 = 15min.
    const a = { start: new Date("2026-08-06T12:30:00.000Z"), durationMinutes: 45 };
    const b = { start: new Date("2026-08-06T13:00:00.000Z"), durationMinutes: 60 };
    expect(computeOverlapMinutes(a, b)).toBe(15);
    expect(isScheduleCompatible(a, b)).toBe(true);
  });

  it("returns 0 for non-overlapping windows and is not compatible", () => {
    const a = { start: new Date("2026-08-06T12:00:00.000Z"), durationMinutes: 30 };
    const b = { start: new Date("2026-08-06T13:00:00.000Z"), durationMinutes: 30 };
    expect(computeOverlapMinutes(a, b)).toBe(0);
    expect(isScheduleCompatible(a, b)).toBe(false);
  });

  it("a 14-minute overlap is below the 15-minute compatibility threshold", () => {
    const a = { start: new Date("2026-08-06T12:00:00.000Z"), durationMinutes: 30 };
    const b = { start: new Date("2026-08-06T12:16:00.000Z"), durationMinutes: 30 };
    expect(computeOverlapMinutes(a, b)).toBe(14);
    expect(isScheduleCompatible(a, b)).toBe(false);
  });
});
