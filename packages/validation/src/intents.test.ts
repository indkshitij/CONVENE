import { describe, expect, it } from "vitest";
import {
  EXPIRES_IN_DAYS_ERROR,
  INTENT_DETAIL_ERROR,
  INTENT_TYPE_ERROR,
  createIntentSchema,
  expiresInDaysSchema,
  intentDetailSchema,
  intentTypeSchema,
} from "./intents";

describe("intentTypeSchema", () => {
  it("accepts each of the 14 documented intent types", () => {
    const types = [
      "looking_for_job",
      "hiring",
      "need_cofounder",
      "need_mentor",
      "need_mentee",
      "internship",
      "freelancer",
      "startup_discussion",
      "ai_collaboration",
      "business_networking",
      "coffee_chat",
      "learning",
      "investment_discussion",
      "partnerships",
    ];
    for (const type of types) {
      expect(intentTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects an unknown intent type", () => {
    const result = intentTypeSchema.safeParse("networking_for_fun");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INTENT_TYPE_ERROR);
  });
});

describe("intentDetailSchema", () => {
  it("accepts valid detail text", () => {
    expect(
      intentDetailSchema.safeParse(
        "Building B2B AI ops tooling, pre-seed, looking for a technical co-founder",
      ).success,
    ).toBe(true);
  });

  it("rejects detail over 200 chars", () => {
    const result = intentDetailSchema.safeParse("a".repeat(201));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INTENT_DETAIL_ERROR);
  });

  it("rejects detail containing an email", () => {
    const result = intentDetailSchema.safeParse("Email me at ananya@example.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INTENT_DETAIL_ERROR);
  });
});

describe("expiresInDaysSchema", () => {
  it("accepts each of the documented options", () => {
    for (const value of [7, 14, 30, 90]) {
      expect(expiresInDaysSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects a value outside the documented options", () => {
    const result = expiresInDaysSchema.safeParse(60);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EXPIRES_IN_DAYS_ERROR);
  });
});

describe("createIntentSchema", () => {
  it("accepts the PRD §10.4.6 worked example", () => {
    const result = createIntentSchema.safeParse({
      type: "need_cofounder",
      detail: "Building B2B AI ops tooling, pre-seed, looking for a technical co-founder",
      expires_in_days: 30,
      is_primary: true,
      metadata: {
        stage: "pre_seed",
        equity_range: "20-40",
        looking_for_skills: ["Backend", "ML Engineering"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown intent type", () => {
    const result = createIntentSchema.safeParse({ type: "unknown_type", expires_in_days: 30 });
    expect(result.success).toBe(false);
  });
});
