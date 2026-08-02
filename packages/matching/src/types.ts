import { intents } from "@convene/validation";

// PRD §10.4.2 — reused from @convene/validation rather than re-transcribed,
// since it's the same 14-type taxonomy the profile/intents domain already
// owns.
export type IntentType = intents.IntentType;
export const INTENT_TYPES = intents.INTENT_TYPES;

// PRD §10.3.4 — the six availability states.
export type AvailabilityState =
  "available_now" | "scheduled" | "busy" | "away" | "offline" | "invisible";

// P4.2 implementation note: "no dates from Date.now() (inject a clock)."
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// PRD §11.5.3: "Functional areas: engineering, data/ML, design, product,
// growth/marketing, sales/BD, finance, ops, legal." Transcribed verbatim,
// nine areas.
export const FUNCTIONAL_AREAS = [
  "engineering",
  "data_ml",
  "design",
  "product",
  "growth_marketing",
  "sales_bd",
  "finance",
  "ops",
  "legal",
] as const;

export type FunctionalArea = (typeof FUNCTIONAL_AREAS)[number];

// PRD §11.5.3/§11.5.4 reference an `intentFamily(v, c)` helper by name in
// several sub-score formulas (skill, experience) without giving its own
// definition anywhere in §11 — only the branches that consume its output
// are specified ("mentorship, learning, ai_collaboration", "cofounder",
// "hiring, job, internship, freelance"). This is this package's own
// interpretation of that undocumented helper: it looks at the two intent
// lists for a specific type (or complementary pair) and returns the
// matching family, checked in a fixed priority order. Flagged as an
// assumption, not a transcription.
export type IntentFamily =
  | "mentorship_seeking"
  | "mentorship_offering"
  | "cofounder"
  | "hiring"
  | "learning"
  | "ai_collaboration"
  | "peer";

export interface IntentRef {
  type: IntentType;
  isPrimary: boolean;
  detail?: string;
}

function hasType(intentRefs: readonly IntentRef[], type: IntentType): boolean {
  return intentRefs.some((intent) => intent.type === type);
}

export function resolveIntentFamily(
  viewerIntents: readonly IntentRef[],
  candidateIntents: readonly IntentRef[],
): IntentFamily {
  if (hasType(viewerIntents, "need_cofounder") && hasType(candidateIntents, "need_cofounder")) {
    return "cofounder";
  }
  if (
    hasType(viewerIntents, "hiring") ||
    hasType(candidateIntents, "hiring") ||
    hasType(viewerIntents, "looking_for_job") ||
    hasType(viewerIntents, "internship") ||
    hasType(viewerIntents, "freelancer")
  ) {
    return "hiring";
  }
  if (hasType(viewerIntents, "need_mentor")) return "mentorship_seeking";
  if (hasType(viewerIntents, "need_mentee")) return "mentorship_offering";
  if (hasType(viewerIntents, "ai_collaboration") || hasType(candidateIntents, "ai_collaboration")) {
    return "ai_collaboration";
  }
  if (hasType(viewerIntents, "learning") || hasType(candidateIntents, "learning")) {
    return "learning";
  }
  return "peer";
}
