import { describe, expect, it } from "vitest";
import {
  EMAIL_DISPOSABLE_ERROR,
  EMAIL_FORMAT_ERROR,
  FULL_NAME_ERROR,
  emailSchema,
  fullNameSchema,
  passwordChangeSchema,
  registerSchema,
} from "./auth";

describe("emailSchema", () => {
  it("accepts a valid email and lowercases it", () => {
    const result = emailSchema.safeParse("Ananya@Example.com");
    expect(result.success).toBe(true);
    expect(result.data).toBe("ananya@example.com");
  });

  it("rejects a malformed email", () => {
    const result = emailSchema.safeParse("not-an-email");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EMAIL_FORMAT_ERROR);
  });

  it("rejects an email over 254 chars", () => {
    const longLocal = "a".repeat(250);
    const result = emailSchema.safeParse(`${longLocal}@example.com`);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EMAIL_FORMAT_ERROR);
  });

  it("rejects a disposable-domain email", () => {
    const result = emailSchema.safeParse("someone@mailinator.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EMAIL_DISPOSABLE_ERROR);
  });
});

describe("fullNameSchema", () => {
  it("accepts a valid name", () => {
    expect(fullNameSchema.safeParse("Ananya Rao").success).toBe(true);
  });

  it("accepts names with hyphens, apostrophes and periods", () => {
    expect(fullNameSchema.safeParse("Mary-Jane O'Brien Jr.").success).toBe(true);
  });

  it("rejects a name under 2 chars", () => {
    const result = fullNameSchema.safeParse("A");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(FULL_NAME_ERROR);
  });

  it("rejects a name over 80 chars", () => {
    const result = fullNameSchema.safeParse("A".repeat(81));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(FULL_NAME_ERROR);
  });

  it("rejects a name containing a URL", () => {
    const result = fullNameSchema.safeParse("Visit https://spam.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(FULL_NAME_ERROR);
  });

  it("rejects a name containing emoji", () => {
    const result = fullNameSchema.safeParse("Ananya 🚀");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(FULL_NAME_ERROR);
  });

  it("rejects a name with 3+ consecutive identical characters", () => {
    const result = fullNameSchema.safeParse("Aaaanya Rao");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(FULL_NAME_ERROR);
  });
});

describe("registerSchema", () => {
  it("accepts a valid registration payload (the PRD §10.1.7 worked example)", () => {
    const result = registerSchema.safeParse({
      method: "email",
      email: "ananya@example.com",
      password: "correct-horse-9",
      full_name: "Ananya Rao",
      date_of_birth: "2003-04-11",
      accepted_terms_version: "2026-06-01",
      device: { platform: "web", fingerprint: "sha256:...", push_token: null },
      attribution: { utm_source: "campus_bengaluru", referral_code: "ROHAN42" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a registration with an underage DOB", () => {
    const result = registerSchema.safeParse({
      method: "email",
      email: "ananya@example.com",
      password: "correct-horse-9",
      full_name: "Ananya Rao",
      date_of_birth: "2015-04-11",
      accepted_terms_version: "2026-06-01",
    });
    expect(result.success).toBe(false);
  });
});

describe("passwordChangeSchema", () => {
  it("accepts a current password and a policy-valid new password", () => {
    const result = passwordChangeSchema.safeParse({
      current_password: "whatever-the-user-typed",
      new_password: "correct-horse-9",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a new password that fails the structural policy", () => {
    const result = passwordChangeSchema.safeParse({
      current_password: "whatever",
      new_password: "short",
    });
    expect(result.success).toBe(false);
  });
});
