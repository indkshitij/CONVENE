import type { IntentType } from "./types";
import type { SubScoreKey, SubScores } from "./score";
import type { MatchingWeights } from "./weights";
import { DEFAULT_WEIGHTS } from "./weights";

// PRD §11.10: "Deterministic, template-based. No LLM in the hot path —
// latency and cost." Every template below is built exclusively from
// structured/curated fields (curated intent phrases keyed by the closed
// 14-type enum, counts, industry labels, city names) — never from a
// user's free-text fields (intent.detail, profile.about, etc.), per the
// P4.3 prompt's explicit "no string interpolation from user text."
//
// The PRD doesn't enumerate a full phrase dictionary for every intent
// type — only the worked example's need_mentor/need_mentee pair is shown
// ("You're looking for a mentor — Meera is mentoring right now"). This is
// a defensible, curated completion for the other 12 types, not a
// transcription; flagged here and in the PR description.
const INTENT_SEEK_PHRASES: Record<IntentType, string> = {
  looking_for_job: "looking for a job",
  hiring: "hiring",
  need_cofounder: "looking for a co-founder",
  need_mentor: "looking for a mentor",
  need_mentee: "looking to mentor",
  internship: "looking for an internship",
  freelancer: "available for freelance work",
  startup_discussion: "up for a startup discussion",
  ai_collaboration: "looking for AI/tech collaboration",
  business_networking: "networking",
  coffee_chat: "up for a coffee chat",
  learning: "looking to learn or exchange skills",
  investment_discussion: "up for an investment discussion",
  partnerships: "looking for partnerships",
};

const INTENT_OFFER_PHRASES: Record<IntentType, string> = {
  looking_for_job: "looking for a job",
  hiring: "hiring",
  need_cofounder: "looking for a co-founder",
  need_mentor: "looking for a mentor",
  need_mentee: "mentoring right now",
  internship: "looking for an internship",
  freelancer: "available for freelance work",
  startup_discussion: "up for a startup discussion",
  ai_collaboration: "open to AI/tech collaboration",
  business_networking: "networking",
  coffee_chat: "up for a coffee chat",
  learning: "looking to learn or exchange skills",
  investment_discussion: "up for an investment discussion",
  partnerships: "open to partnerships",
};

export interface ReasonContext {
  viewerPrimaryIntentType?: IntentType;
  candidateFirstName: string;
  candidatePrimaryIntentType?: IntentType;
  candidateAvailabilityState:
    "available_now" | "scheduled" | "busy" | "away" | "offline" | "invisible";
  candidateMinutesLeft?: number;
  candidateNextWindowHuman?: string;
  candidateDistanceBucket?: string;
  candidateLocationTier?: number;
  candidateCity?: string;
  sharedSkillCount?: number;
  topSharedSkill?: string;
  mutualCount?: number;
  candidateYearsExperience?: number;
  candidateIndustryLabel?: string;
  expNotable?: boolean;
  sameIndustry?: boolean;
  candidateResponseRate?: number;
}

function intentReason(ctx: ReasonContext): string | null {
  if (!ctx.viewerPrimaryIntentType || !ctx.candidatePrimaryIntentType) return null;
  const seekPhrase = INTENT_SEEK_PHRASES[ctx.viewerPrimaryIntentType];
  const offerPhrase = INTENT_OFFER_PHRASES[ctx.candidatePrimaryIntentType];
  return `You're ${seekPhrase} — ${ctx.candidateFirstName} is ${offerPhrase}`;
}

function availabilityReason(ctx: ReasonContext): string | null {
  if (ctx.candidateAvailabilityState === "available_now") {
    if (ctx.candidateMinutesLeft === undefined) return null;
    return `Available right now — expires in ${ctx.candidateMinutesLeft} min`;
  }
  if (ctx.candidateNextWindowHuman) {
    return `Free ${ctx.candidateNextWindowHuman}`;
  }
  return null;
}

function locationReason(ctx: ReasonContext): string | null {
  if (ctx.candidateLocationTier === undefined) return null;
  if (ctx.candidateLocationTier <= 1) return ctx.candidateDistanceBucket ?? null;
  if (ctx.candidateLocationTier === 2 && ctx.candidateCity) return `Also in ${ctx.candidateCity}`;
  return null;
}

function skillReason(ctx: ReasonContext): string | null {
  if ((ctx.sharedSkillCount ?? 0) >= 2 && ctx.topSharedSkill) {
    return `${ctx.sharedSkillCount} shared skills including ${ctx.topSharedSkill}`;
  }
  return null;
}

function mutualReason(ctx: ReasonContext): string | null {
  if (!ctx.mutualCount) return null;
  return `${ctx.mutualCount} mutual connection${ctx.mutualCount > 1 ? "s" : ""}`;
}

function expReason(ctx: ReasonContext): string | null {
  if (!ctx.expNotable || ctx.candidateYearsExperience === undefined || !ctx.candidateIndustryLabel)
    return null;
  return `${Math.trunc(ctx.candidateYearsExperience)} years in ${ctx.candidateIndustryLabel}`;
}

function industryReason(ctx: ReasonContext): string | null {
  if (!ctx.sameIndustry || !ctx.candidateIndustryLabel) return null;
  return `Both in ${ctx.candidateIndustryLabel}`;
}

function repReason(ctx: ReasonContext): string | null {
  if (ctx.candidateResponseRate === undefined || ctx.candidateResponseRate < 0.7) return null;
  return `Replies to ${Math.round(ctx.candidateResponseRate * 100)}% of messages`;
}

// PRD §11.10 REASON_TEMPLATES, keyed the same as the sub-score map so the
// contribution-sort below can look weights/values up by the same key.
// "skill"/"mutual"/"exp"/"industry"/"rep" map onto this package's "skill"/
// "mutual"/"exp"/"industry"/"rep" SubScoreKey names; "avail"/"intent"/
// "loc" likewise.
const REASON_TEMPLATES: Partial<Record<SubScoreKey, (ctx: ReasonContext) => string | null>> = {
  intent: intentReason,
  avail: availabilityReason,
  loc: locationReason,
  skill: skillReason,
  mutual: mutualReason,
  exp: expReason,
  industry: industryReason,
  rep: repReason,
};

// PRD §11.10: "contribs = sorted(((k, weights[k] * (components[k] -
// BASELINE[k])) for k in components), key=desc)." BASELINE isn't defined
// anywhere in §11 — no values are given for it. Treated as 0 for every
// key (i.e. contribution = weight × value), which is the only defensible
// default absent any stated baseline; flagged as an assumption.
function rankByContribution(subScores: SubScores, weights: MatchingWeights): SubScoreKey[] {
  const keys = Object.keys(subScores) as SubScoreKey[];
  return keys
    .filter((key) => REASON_TEMPLATES[key] !== undefined)
    .map((key) => ({ key, contribution: weights[key] * (subScores[key] ?? 0) }))
    .sort((a, b) => b.contribution - a.contribution)
    .map((entry) => entry.key);
}

// PRD §11.10 generate_reasons(): iterate keys ranked by contribution
// (highest first), emit each template's non-null output, stop at top_n.
export function generateReasons(
  subScores: SubScores,
  ctx: ReasonContext,
  topN = 3,
  weights: MatchingWeights = DEFAULT_WEIGHTS,
): string[] {
  const rankedKeys = rankByContribution(subScores, weights);
  const reasons: string[] = [];

  for (const key of rankedKeys) {
    // rankedKeys is already filtered (in rankByContribution) to only keys
    // with a template, so this lookup is always defined — no fallback
    // needed here.
    const template = REASON_TEMPLATES[key] as (ctx: ReasonContext) => string | null;
    const reason = template(ctx);
    if (reason !== null) reasons.push(reason);
    if (reasons.length === topN) break;
  }

  return reasons;
}
