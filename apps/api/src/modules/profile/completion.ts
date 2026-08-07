// PRD §10.2.4 profile completion formula — 12 weighted components summing
// to exactly 100. Pure function over plain facts (no DB access) so it can
// be unit-tested against hand-computed fixtures without a database.

export interface CompletionFacts {
  fullNamePresent: boolean;
  avatarPresent: boolean;
  avatarModerationPassed: boolean;
  headlineLength: number;
  aboutLength: number;
  hasIndustry: boolean;
  hasJobTitle: boolean;
  hasCompany: boolean;
  skillsCount: number;
  // §10.2.4: "≥1 entry with dates and ≥40-char description." startDate is
  // NOT NULL on every experience row (migrations/0001_profile_geo.sql), so
  // "with dates" reduces to "has at least one experience row at all" —
  // only descriptionLength varies per entry.
  experienceDescriptionLengths: number[];
  educationCount: number;
  interestsCount: number;
  languagesCount: number;
  hasCity: boolean;
  hasValidTimezone: boolean;
  verificationLevel: number;
  activeIntentsCount: number;
}

export interface CompletionMissingItem {
  field: string;
  impact: number;
  cta: string;
}

export interface CompletionResult {
  score: number;
  missing: CompletionMissingItem[];
}

interface Component {
  field: string;
  weight: number;
  cta: string;
  met: (facts: CompletionFacts) => boolean;
}

// Weights sum to exactly 100 — asserted by a property test, not just this
// comment (packages/validation-style discipline: don't trust a comment to
// stay true).
const COMPONENTS: Component[] = [
  {
    field: "name_and_avatar",
    weight: 10,
    cta: "Add a profile photo",
    met: (f) => f.fullNamePresent && f.avatarPresent && f.avatarModerationPassed,
  },
  {
    field: "headline",
    weight: 10,
    cta: "Write a headline (at least 20 characters)",
    met: (f) => f.headlineLength >= 20,
  },
  {
    field: "about",
    weight: 10,
    cta: "Write an about section (at least 120 characters)",
    met: (f) => f.aboutLength >= 120,
  },
  {
    field: "industry_job_company",
    weight: 10,
    cta: "Add your industry, job title, and company",
    met: (f) => f.hasIndustry && f.hasJobTitle && f.hasCompany,
  },
  {
    field: "skills",
    weight: 15,
    cta: "Add at least 5 skills",
    met: (f) => f.skillsCount >= 5,
  },
  {
    field: "experience",
    weight: 15,
    cta: "Add a work experience entry with a description (at least 40 characters)",
    met: (f) => f.experienceDescriptionLengths.some((len) => len >= 40),
  },
  {
    field: "education",
    weight: 5,
    cta: "Add an education entry",
    met: (f) => f.educationCount >= 1,
  },
  {
    field: "interests",
    weight: 5,
    cta: "Add at least 3 interests",
    met: (f) => f.interestsCount >= 3,
  },
  {
    field: "languages",
    weight: 3,
    cta: "Add at least 1 language",
    met: (f) => f.languagesCount >= 1,
  },
  {
    field: "location_and_timezone",
    weight: 7,
    cta: "Add your city and timezone",
    met: (f) => f.hasCity && f.hasValidTimezone,
  },
  {
    field: "verification",
    weight: 5,
    cta: "Verify at least one channel (email or phone)",
    met: (f) => f.verificationLevel >= 1,
  },
  {
    field: "intents",
    weight: 5,
    cta: "Set at least one active intent",
    met: (f) => f.activeIntentsCount >= 1,
  },
];

export function computeProfileCompletion(facts: CompletionFacts): CompletionResult {
  let score = 0;
  const missing: CompletionMissingItem[] = [];
  for (const component of COMPONENTS) {
    if (component.met(facts)) {
      score += component.weight;
    } else {
      missing.push({ field: component.field, impact: component.weight, cta: component.cta });
    }
  }
  return { score, missing };
}
