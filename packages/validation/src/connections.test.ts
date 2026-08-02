import { describe, expect, it } from "vitest";
import {
  CONNECTION_NOTE_ERROR,
  connectionNoteSchema,
  createConnectionRequestSchema,
  createReportSchema,
} from "./connections";

describe("connectionNoteSchema", () => {
  it("accepts a valid note", () => {
    expect(
      connectionNoteSchema.safeParse(
        "Saw you lead NLP at Xenon — I'm 1.5 yrs into payments ML and would value 20 min.",
      ).success,
    ).toBe(true);
  });

  it("rejects a note over 300 chars", () => {
    const result = connectionNoteSchema.safeParse("a".repeat(301));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(CONNECTION_NOTE_ERROR);
  });

  it("rejects a note containing an email", () => {
    const result = connectionNoteSchema.safeParse("Reach me at ananya@example.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(CONNECTION_NOTE_ERROR);
  });

  it("rejects a note containing a phone number", () => {
    const result = connectionNoteSchema.safeParse("Call +91 98765 43210");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(CONNECTION_NOTE_ERROR);
  });
});

describe("createConnectionRequestSchema", () => {
  it("accepts the PRD §10.6.6 worked example", () => {
    const result = createConnectionRequestSchema.safeParse({
      recipient_id: "018f-b2",
      intent_id: "018f-a1",
      note: "Saw you lead NLP at Xenon — I'm 1.5 yrs into payments ML and would value 20 min on how you chose depth over breadth.",
      source: "available_now_feed",
      match_score: 78,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing recipient_id", () => {
    const result = createConnectionRequestSchema.safeParse({ intent_id: "018f-a1" });
    expect(result.success).toBe(false);
  });
});

describe("createReportSchema", () => {
  it("accepts the PRD §10.6.6 worked example", () => {
    const result = createReportSchema.safeParse({
      target_type: "user",
      target_id: "018f-b2",
      category: "harassment",
      description: "Repeated unwanted messages after being asked to stop.",
      evidence_message_ids: ["018f-m1"],
      also_block: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const result = createReportSchema.safeParse({
      target_type: "user",
      target_id: "018f-b2",
      category: "annoying",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown target_type", () => {
    const result = createReportSchema.safeParse({
      target_type: "group",
      target_id: "018f-b2",
      category: "spam",
    });
    expect(result.success).toBe(false);
  });
});
