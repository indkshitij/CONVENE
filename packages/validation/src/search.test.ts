import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_STATE_ERROR,
  EXPERIENCE_RANGE_ERROR,
  SEARCH_LIMIT_ERROR,
  SEARCH_QUERY_ERROR,
  SKILLS_OP_ERROR,
  availabilityStateSchema,
  experienceYearsSchema,
  searchLimitSchema,
  searchQuerySchema,
  searchUsersSchema,
  skillsOpSchema,
} from "./search";

describe("searchQuerySchema", () => {
  it("accepts a query of 2 or more chars", () => {
    expect(searchQuerySchema.safeParse("nlp").success).toBe(true);
  });

  it("rejects a query under 2 chars", () => {
    const result = searchQuerySchema.safeParse("n");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SEARCH_QUERY_ERROR);
  });
});

describe("skillsOpSchema", () => {
  it("accepts 'and' and 'or'", () => {
    expect(skillsOpSchema.safeParse("and").success).toBe(true);
    expect(skillsOpSchema.safeParse("or").success).toBe(true);
  });

  it("rejects an unknown operator", () => {
    const result = skillsOpSchema.safeParse("xor");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SKILLS_OP_ERROR);
  });
});

describe("experienceYearsSchema", () => {
  it("accepts a value within 0-60", () => {
    expect(experienceYearsSchema.safeParse(8).success).toBe(true);
  });

  it("rejects a negative value", () => {
    const result = experienceYearsSchema.safeParse(-1);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EXPERIENCE_RANGE_ERROR);
  });

  it("rejects a value over 60", () => {
    const result = experienceYearsSchema.safeParse(61);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EXPERIENCE_RANGE_ERROR);
  });
});

describe("availabilityStateSchema", () => {
  it("accepts each of the 6 documented states", () => {
    for (const state of ["available_now", "busy", "away", "invisible", "offline", "scheduled"]) {
      expect(availabilityStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it("rejects an unknown state", () => {
    const result = availabilityStateSchema.safeParse("napping");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(AVAILABILITY_STATE_ERROR);
  });
});

describe("searchLimitSchema", () => {
  it("accepts a value within 1-200", () => {
    expect(searchLimitSchema.safeParse(50).success).toBe(true);
  });

  it("rejects a value over 200", () => {
    const result = searchLimitSchema.safeParse(201);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SEARCH_LIMIT_ERROR);
  });
});

describe("searchUsersSchema", () => {
  it("accepts the PRD §10.9.2 worked example", () => {
    const result = searchUsersSchema.safeParse({
      q: "nlp mentor",
      intents: ["need_mentee"],
      industry: 3,
      min_exp: 8,
      skills: ["NLP", "LLM"],
      skills_op: "and",
      availability: "available_now",
      radius_km: 50,
      verified_only: true,
      sort: "relevance",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a query under 2 chars", () => {
    const result = searchUsersSchema.safeParse({ q: "n" });
    expect(result.success).toBe(false);
  });
});
