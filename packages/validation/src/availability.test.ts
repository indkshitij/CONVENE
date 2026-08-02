import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_NOTE_ERROR,
  DURATION_MINUTES_ERROR,
  RECURRENCE_ERROR,
  SCHEDULE_START_AT_ERROR,
  SESSION_INTENT_IDS_ERROR,
  availabilityNoteSchema,
  durationMinutesSchema,
  recurrenceSchema,
  scheduleDurationMinutesSchema,
  scheduleStartAtSchema,
  sessionIntentIdsSchema,
} from "./availability";

describe("durationMinutesSchema (availability duration_minutes)", () => {
  it("accepts a standard enum value", () => {
    expect(durationMinutesSchema(false).safeParse(30).success).toBe(true);
  });

  it("rejects a non-enum value on the standard plan", () => {
    const result = durationMinutesSchema(false).safeParse(45);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DURATION_MINUTES_ERROR);
  });
});

describe("availabilityNoteSchema", () => {
  it("accepts a valid note", () => {
    expect(
      availabilityNoteSchema.safeParse("Free for 30 min — happy to talk NLP or careers").success,
    ).toBe(true);
  });

  it("rejects a note over 120 chars", () => {
    const result = availabilityNoteSchema.safeParse("a".repeat(121));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(AVAILABILITY_NOTE_ERROR);
  });

  it("rejects a note containing an email", () => {
    const result = availabilityNoteSchema.safeParse("DM me at ananya@example.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(AVAILABILITY_NOTE_ERROR);
  });

  it("rejects a note containing a URL", () => {
    const result = availabilityNoteSchema.safeParse("Details at https://example.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(AVAILABILITY_NOTE_ERROR);
  });
});

describe("sessionIntentIdsSchema", () => {
  it("accepts up to 5 intent ids", () => {
    expect(sessionIntentIdsSchema.safeParse(["a", "b", "c"]).success).toBe(true);
  });

  it("rejects more than 5 intent ids", () => {
    const result = sessionIntentIdsSchema.safeParse(["a", "b", "c", "d", "e", "f"]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SESSION_INTENT_IDS_ERROR);
  });
});

describe("scheduleStartAtSchema", () => {
  const now = new Date("2026-08-02T00:00:00Z");

  it("accepts a future date within 90 days", () => {
    expect(scheduleStartAtSchema(now).safeParse("2026-08-10T00:00:00Z").success).toBe(true);
  });

  it("rejects a date in the past", () => {
    const result = scheduleStartAtSchema(now).safeParse("2026-07-01T00:00:00Z");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SCHEDULE_START_AT_ERROR);
  });

  it("rejects a date more than 90 days ahead", () => {
    const result = scheduleStartAtSchema(now).safeParse("2027-01-01T00:00:00Z");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SCHEDULE_START_AT_ERROR);
  });
});

describe("scheduleDurationMinutesSchema", () => {
  it("accepts a value within 15-240", () => {
    expect(scheduleDurationMinutesSchema.safeParse(60).success).toBe(true);
  });

  it("rejects a value under 15", () => {
    const result = scheduleDurationMinutesSchema.safeParse(10);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DURATION_MINUTES_ERROR);
  });

  it("rejects a value over 240", () => {
    const result = scheduleDurationMinutesSchema.safeParse(241);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DURATION_MINUTES_ERROR);
  });
});

describe("recurrenceSchema", () => {
  it("accepts a valid weekly recurrence", () => {
    const result = recurrenceSchema.safeParse({ freq: "WEEKLY", byday: ["TU", "TH"], count: 20 });
    expect(result.success).toBe(true);
  });

  it("rejects a non-WEEKLY freq", () => {
    const result = recurrenceSchema.safeParse({ freq: "DAILY", byday: ["TU"] });
    expect(result.success).toBe(false);
  });

  it("rejects a count over 52 (roughly 1 year of weekly occurrences)", () => {
    const result = recurrenceSchema.safeParse({ freq: "WEEKLY", byday: ["TU"], count: 53 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(RECURRENCE_ERROR);
  });

  it("rejects an until date more than 1 year out", () => {
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 2);
    const result = recurrenceSchema.safeParse({
      freq: "WEEKLY",
      byday: ["TU"],
      until: farFuture.toISOString(),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(RECURRENCE_ERROR);
  });
});
