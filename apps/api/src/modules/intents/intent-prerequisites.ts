import type { intents as intentsValidation } from "@convene/validation";
import { INTENT_TAXONOMY } from "./intent-taxonomy";

type IntentType = intentsValidation.IntentType;

// PRD BR-INT-05 / §10.4.2's "Requires" column. Facts are whatever a
// prerequisite id needs to evaluate — kept flat rather than a full
// Profile type so this stays pure and trivially testable without a DB.
export interface PrerequisiteFacts {
  hasCompanyName: boolean;
  verificationLevel: number;
  yearsExperience: number;
}

type PrerequisiteCheck = (facts: PrerequisiteFacts) => boolean;

// One rule per prerequisite id named in intent-taxonomy.ts's
// `prerequisites` arrays — every id used there must have an entry here
// (asserted by a test) so a typo in one silently no-ops instead of
// failing loudly.
const PREREQUISITE_RULES: Record<string, PrerequisiteCheck> = {
  company_on_profile: (facts) => facts.hasCompanyName,
  verification_level_2: (facts) => facts.verificationLevel >= 2,
  verification_level_4: (facts) => facts.verificationLevel >= 4,
  experience_years_3: (facts) => facts.yearsExperience >= 3,
};

export const PREREQUISITE_RULE_IDS: string[] = Object.keys(PREREQUISITE_RULES);

export interface PrerequisiteResult {
  met: boolean;
  /** §10.4.6: `details.unmet: ["verification_level_4"]` — the exact ids the Gherkin scenario names. */
  unmet: string[];
}

export function checkPrerequisites(type: IntentType, facts: PrerequisiteFacts): PrerequisiteResult {
  const entry = INTENT_TAXONOMY.find((e) => e.type === type);
  const prerequisiteIds = entry?.prerequisites ?? [];

  const unmet = prerequisiteIds.filter((id) => {
    const rule = PREREQUISITE_RULES[id];
    return rule ? !rule(facts) : false;
  });

  return { met: unmet.length === 0, unmet };
}
