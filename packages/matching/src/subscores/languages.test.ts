import { describe, expect, it } from "vitest";
import { languagesScore } from "./languages";

describe("languagesScore", () => {
  // PRD §11.6's worked example states s_lang=1.00 for "Shared English
  // (native/professional)", but §11.5.4's own formula is "weighted by
  // min(proficiency)" — min(native=1.0, professional=0.85) = 0.85, not
  // 1.00. Same pattern as the s_skill discrepancy in skills.test.ts: the
  // PRD's formula and its own worked-example table disagree. This asserts
  // what the formula actually produces, flagged here and in the PR
  // description rather than silently matching the inconsistent figure.
  it("weights shared native/professional English by the minimum proficiency (§11.5.4 formula, not the inconsistent §11.6 table value)", () => {
    const score = languagesScore(
      [{ code: "en", proficiency: "native" }],
      [{ code: "en", proficiency: "professional" }],
    );
    expect(score).toBeCloseTo(0.85, 5);
  });

  it("returns 0.0 when no languages are shared", () => {
    const score = languagesScore(
      [{ code: "hi", proficiency: "native" }],
      [{ code: "en", proficiency: "native" }],
    );
    expect(score).toBe(0.0);
  });

  it("weights a shared language by the minimum of the two proficiencies", () => {
    const score = languagesScore(
      [{ code: "fr", proficiency: "basic" }],
      [{ code: "fr", proficiency: "native" }],
    );
    expect(score).toBeCloseTo(0.3, 5);
  });

  it("takes the max across multiple shared languages", () => {
    const score = languagesScore(
      [
        { code: "fr", proficiency: "basic" },
        { code: "en", proficiency: "native" },
      ],
      [
        { code: "fr", proficiency: "native" },
        { code: "en", proficiency: "native" },
      ],
    );
    // fr: min(basic=0.3, native=1.0)=0.3; en: min(native,native)=1.0; max=1.0
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("returns 0.0 when either language list is empty", () => {
    expect(languagesScore([], [{ code: "en", proficiency: "native" }])).toBe(0.0);
    expect(languagesScore([{ code: "en", proficiency: "native" }], [])).toBe(0.0);
  });
});
