import { intents as intentsValidation } from "@convene/validation";
import { describe, expect, it } from "vitest";
import { INTENT_TAXONOMY } from "./intent-taxonomy";
import { PREREQUISITE_RULE_IDS } from "./intent-prerequisites";

describe("INTENT_TAXONOMY", () => {
  it("has exactly the 14 PRD §10.4.2 types, in the schema's own order", () => {
    expect(INTENT_TAXONOMY.map((e) => e.type)).toEqual(intentsValidation.INTENT_TYPES);
  });

  it("every complements/peer-match reference is itself a valid intent type", () => {
    const validTypes = new Set<string>(intentsValidation.INTENT_TYPES);
    for (const entry of INTENT_TAXONOMY) {
      for (const complement of entry.complements) {
        expect(validTypes.has(complement)).toBe(true);
      }
    }
  });

  it("every prerequisite id referenced is a rule intent-prerequisites.ts actually implements", () => {
    for (const entry of INTENT_TAXONOMY) {
      for (const prerequisiteId of entry.prerequisites) {
        expect(PREREQUISITE_RULE_IDS).toContain(prerequisiteId);
      }
    }
  });

  it("matches §10.4.2's four prerequisite-bearing types exactly", () => {
    const withPrereqs = INTENT_TAXONOMY.filter((e) => e.prerequisites.length > 0).map(
      (e) => e.type,
    );
    expect(withPrereqs.sort()).toEqual(
      ["hiring", "need_cofounder", "need_mentee", "investment_discussion"].sort(),
    );
  });
});
