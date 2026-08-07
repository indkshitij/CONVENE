import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CompletionFacts, computeProfileCompletion } from "./completion";

const NO_FACTS: CompletionFacts = {
  fullNamePresent: false,
  avatarPresent: false,
  avatarModerationPassed: false,
  headlineLength: 0,
  aboutLength: 0,
  hasIndustry: false,
  hasJobTitle: false,
  hasCompany: false,
  skillsCount: 0,
  experienceDescriptionLengths: [],
  educationCount: 0,
  interestsCount: 0,
  languagesCount: 0,
  hasCity: false,
  hasValidTimezone: false,
  verificationLevel: 0,
  activeIntentsCount: 0,
};

const ALL_FACTS: CompletionFacts = {
  fullNamePresent: true,
  avatarPresent: true,
  avatarModerationPassed: true,
  headlineLength: 20,
  aboutLength: 120,
  hasIndustry: true,
  hasJobTitle: true,
  hasCompany: true,
  skillsCount: 5,
  experienceDescriptionLengths: [40],
  educationCount: 1,
  interestsCount: 3,
  languagesCount: 1,
  hasCity: true,
  hasValidTimezone: true,
  verificationLevel: 1,
  activeIntentsCount: 1,
};

describe("computeProfileCompletion", () => {
  it("scores 0 with every component missing, and lists all twelve as missing", () => {
    const result = computeProfileCompletion(NO_FACTS);
    expect(result.score).toBe(0);
    expect(result.missing).toHaveLength(12);
    expect(result.missing.reduce((sum, m) => sum + m.impact, 0)).toBe(100);
  });

  it("scores 100 with every component satisfied at its exact threshold, and lists nothing missing", () => {
    const result = computeProfileCompletion(ALL_FACTS);
    expect(result.score).toBe(100);
    expect(result.missing).toEqual([]);
  });

  // §10.2.4 hand-computed fixtures: exactly the name+avatar (10), headline
  // (10), and verification (5) components met — 25 total, and the missing
  // list flags the other nine.
  it("computes a partial profile per the §10.2.4 table", () => {
    const facts: CompletionFacts = {
      ...NO_FACTS,
      fullNamePresent: true,
      avatarPresent: true,
      avatarModerationPassed: true,
      headlineLength: 25,
      verificationLevel: 1,
    };
    const result = computeProfileCompletion(facts);
    expect(result.score).toBe(25);
    expect(result.missing.map((m) => m.field).sort()).toEqual(
      [
        "about",
        "education",
        "experience",
        "industry_job_company",
        "interests",
        "intents",
        "languages",
        "location_and_timezone",
        "skills",
      ].sort(),
    );
  });

  it("is right below a threshold for skills (4 of 5) — component not credited", () => {
    const result = computeProfileCompletion({ ...ALL_FACTS, skillsCount: 4 });
    expect(result.score).toBe(85);
    expect(result.missing).toEqual([{ field: "skills", impact: 15, cta: expect.any(String) }]);
  });

  it("only credits experience when at least one description reaches 40 characters", () => {
    const shortOnly = computeProfileCompletion({
      ...ALL_FACTS,
      experienceDescriptionLengths: [10, 39],
    });
    expect(shortOnly.missing.map((m) => m.field)).toContain("experience");

    const oneLongEnough = computeProfileCompletion({
      ...ALL_FACTS,
      experienceDescriptionLengths: [10, 40],
    });
    expect(oneLongEnough.missing).toEqual([]);
  });

  it("weights sum to exactly 100 (verified by the all-satisfied fixture reaching 100)", () => {
    expect(computeProfileCompletion(ALL_FACTS).score).toBe(100);
  });

  it("property: score is always between 0 and 100 for any combination of facts", () => {
    fc.assert(
      fc.property(
        fc.record({
          fullNamePresent: fc.boolean(),
          avatarPresent: fc.boolean(),
          avatarModerationPassed: fc.boolean(),
          headlineLength: fc.nat({ max: 200 }),
          aboutLength: fc.nat({ max: 3000 }),
          hasIndustry: fc.boolean(),
          hasJobTitle: fc.boolean(),
          hasCompany: fc.boolean(),
          skillsCount: fc.nat({ max: 40 }),
          experienceDescriptionLengths: fc.array(fc.nat({ max: 1300 }), { maxLength: 10 }),
          educationCount: fc.nat({ max: 10 }),
          interestsCount: fc.nat({ max: 20 }),
          languagesCount: fc.nat({ max: 10 }),
          hasCity: fc.boolean(),
          hasValidTimezone: fc.boolean(),
          verificationLevel: fc.integer({ min: 0, max: 4 }),
          activeIntentsCount: fc.nat({ max: 5 }),
        }),
        (facts) => {
          const result = computeProfileCompletion(facts);
          expect(result.score).toBeGreaterThanOrEqual(0);
          expect(result.score).toBeLessThanOrEqual(100);
          expect(result.score + result.missing.reduce((sum, m) => sum + m.impact, 0)).toBe(100);
        },
      ),
    );
  });
});
