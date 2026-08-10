import type { intents as intentsValidation } from "@convene/validation";

type IntentType = intentsValidation.IntentType;

// PRD §10.4.2 — the 14-type taxonomy table, transcribed verbatim. Static
// reference data (no DB round trip): categories, the "principal edges" of
// complementarity/peer-match described in prose, and prerequisite ids
// (checked against a user's actual state by intent-prerequisites.ts, not
// here — this module only describes *what* is required, never evaluates
// it). Feeds GET /intents/taxonomy directly.
export interface IntentTaxonomyEntry {
  type: IntentType;
  label: string;
  category: string;
  /** Intent types this type complements strongly (§10.4.2 "Complements" column). */
  complements: IntentType[];
  /** Free-text summary of the "Also matches (peer)" column — not machine-parsed, just surfaced to the client. */
  peerMatch: string | null;
  /** Prerequisite ids from intent-prerequisites.ts's PREREQUISITE_RULES; empty when the type has none. */
  prerequisites: string[];
}

export const INTENT_TAXONOMY: IntentTaxonomyEntry[] = [
  {
    type: "looking_for_job",
    label: "Looking for a Job",
    category: "Career",
    complements: ["hiring"],
    peerMatch: "looking_for_job (0.3 — peer support)",
    prerequisites: [],
  },
  {
    type: "hiring",
    label: "Hiring",
    category: "Career",
    complements: ["looking_for_job", "freelancer", "internship"],
    peerMatch: null,
    prerequisites: ["company_on_profile"],
  },
  {
    type: "need_cofounder",
    label: "Need a Co-Founder",
    category: "Venture",
    complements: ["need_cofounder"],
    peerMatch: "startup_discussion (0.6)",
    prerequisites: ["verification_level_2"],
  },
  {
    type: "need_mentor",
    label: "Need a Mentor",
    category: "Growth",
    complements: ["need_mentee"],
    peerMatch: "learning (0.4)",
    prerequisites: [],
  },
  {
    type: "need_mentee",
    label: "Want to Mentor",
    category: "Growth",
    complements: ["need_mentor"],
    peerMatch: null,
    prerequisites: ["experience_years_3"],
  },
  {
    type: "internship",
    label: "Looking for an Internship",
    category: "Career",
    complements: ["hiring"],
    peerMatch: null,
    prerequisites: [],
  },
  {
    type: "freelancer",
    label: "Available for Freelance",
    category: "Work",
    complements: ["hiring", "partnerships"],
    peerMatch: null,
    prerequisites: [],
  },
  {
    type: "startup_discussion",
    label: "Startup Discussion",
    category: "Venture",
    complements: ["startup_discussion"],
    peerMatch: "need_cofounder, investment_discussion (0.6)",
    prerequisites: [],
  },
  {
    type: "ai_collaboration",
    label: "AI / Tech Collaboration",
    category: "Build",
    complements: ["ai_collaboration"],
    peerMatch: "learning, partnerships (0.5)",
    prerequisites: [],
  },
  {
    type: "business_networking",
    label: "Business Networking",
    category: "Network",
    complements: ["business_networking"],
    peerMatch: "almost all (0.35 floor)",
    prerequisites: [],
  },
  {
    type: "coffee_chat",
    label: "Coffee Chat",
    category: "Network",
    complements: ["coffee_chat"],
    peerMatch: "all (0.45)",
    prerequisites: [],
  },
  {
    type: "learning",
    label: "Learning / Skill Exchange",
    category: "Growth",
    complements: ["learning", "need_mentee"],
    peerMatch: "ai_collaboration (0.5)",
    prerequisites: [],
  },
  {
    type: "investment_discussion",
    label: "Investment Discussion",
    category: "Venture",
    complements: ["investment_discussion"],
    peerMatch: "startup_discussion (0.7)",
    prerequisites: ["verification_level_4"],
  },
  {
    type: "partnerships",
    label: "Partnerships / BD",
    category: "Business",
    complements: ["partnerships"],
    peerMatch: "freelancer, business_networking (0.55)",
    prerequisites: [],
  },
];
