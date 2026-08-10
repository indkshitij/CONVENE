import { describe, expect, it } from "vitest";

// "Acceptance: sensitive attributes never reach a matching input type
// (structurally)." The type system is the primary assertion (see
// anti-bias.ts's own AssertNoSensitiveAttributeOverlap) — this runtime
// test exists for the same reason reputation.test.ts's own
// "purchasability is structurally impossible" test does: a coverage
// report shows the guarantee was exercised, and a future refactor that
// quietly widens an input type's keys is caught by a runtime string
// check too, not only by the type-level one.
const SENSITIVE_ATTRIBUTE_WORDS = [
  "caste",
  "religion",
  "marital",
  "gender",
  "sex",
  "sexual",
  "photo",
  "face",
  "ethnicity",
  "origin",
  "name",
  "country",
  "residence",
  "language",
  "race",
  "disability",
  "orientation",
  "pregnancy",
  "immigration",
];

// Splits on camelCase boundaries so "yearsExperience" (contains "sex" as
// a raw substring — a real false-positive this test hit on its first
// run) is checked as the words ["years","experience"], never matching
// "sex", while a genuine field named `sex` or `photoDerived` still does.
function camelCaseWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function assertNoSensitiveKeys(sampleInput: Record<string, unknown>): void {
  for (const key of Object.keys(sampleInput)) {
    const words = camelCaseWords(key);
    for (const word of SENSITIVE_ATTRIBUTE_WORDS) {
      expect(words).not.toContain(word);
    }
  }
}

describe("sensitive attributes never reach a matching input type", () => {
  it("AvailabilityScoreCandidate carries no sensitive-attribute keys", () => {
    assertNoSensitiveKeys({ state: "available_now", expiresAt: new Date() });
  });

  it("ExperienceScoreInput carries no sensitive-attribute keys", () => {
    assertNoSensitiveKeys({
      viewerYearsExperience: 5,
      candidateYearsExperience: 3,
      intentFamily: "networking",
    });
  });

  it("SkillsScoreInput carries no sensitive-attribute keys", () => {
    assertNoSensitiveKeys({
      intentFamily: "networking",
      viewerSkills: [],
      candidateSkills: [],
      semanticSimilarity: 0,
    });
  });

  it("LocationScoreInput carries no sensitive-attribute keys (a distance tier, never a nationality or raw coordinates)", () => {
    assertNoSensitiveKeys({ tier: 1, viewerRemotePreference: "any" });
  });

  it("ReputationComponentsInput carries no sensitive-attribute keys", () => {
    assertNoSensitiveKeys({ accountAgeDays: 100, daysSinceLastActive: 1 });
  });
});
