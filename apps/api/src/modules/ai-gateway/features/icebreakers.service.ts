import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { BadRequestAppError } from "../../../common/errors/app-error";
import type { AuthContext } from "../../../common/auth/auth-context";
import { ProfileService } from "../../profile/profile.service";
import { aiFirstMessagesTotal } from "../../../infra/telemetry/ai-metrics";
import { AiGatewayService } from "../gateway.service";
import type { GroundingFacts } from "../prompt-builder";

// §12.5's own three named types, in the exact order the wireframe lists
// them — the validator requires all three, each exactly once.
const ICEBREAKER_TYPES = ["specific_observation", "shared_context", "direct_ask"] as const;
export type IcebreakerType = (typeof ICEBREAKER_TYPES)[number];

// Every opener must cite which grounding-fact keys it actually drew on.
// This is what makes "no invented shared experience / never claim to
// have read something not in the grounding set" mechanically checkable
// by a rule-based validator rather than requiring real NLP fact-
// checking against free text — the model declares its sources, the
// validator verifies each declared source is real.
const icebreakerOpenerSchema = z.object({
  type: z.enum(ICEBREAKER_TYPES),
  text: z.string().min(1).max(320),
  grounded_in: z.array(z.string()),
});

export const icebreakersOutputSchema = z
  .object({
    openers: z.array(icebreakerOpenerSchema).length(3),
  })
  .strict();

export type IcebreakersOutput = z.infer<typeof icebreakersOutputSchema>;

// §12.5's flattery carve-out: "no flattery openers ... unless a
// portfolio item is actually cited." A small, deliberately narrow deny-
// list — this is a defence-in-depth backstop on top of the prompt's own
// instruction, not the primary mechanism (the primary mechanism is
// grounding-citation checking below).
const FLATTERY_PHRASES = [
  "huge fan",
  "impressed by your",
  "you're amazing",
  "so impressive",
  "love your profile",
];
const ROMANTIC_PHRASES = [
  "date you",
  "romantic",
  "attractive",
  "gorgeous",
  "crush on",
  "flirt",
  "chemistry between us",
  "swipe right",
];

export type IcebreakerRejectionReason =
  "WRONG_TYPE_SET" | "UNGROUNDED_FACT" | "ROMANTIC_LANGUAGE" | "UNGROUNDED_FLATTERY";

export function validateIcebreakerHardRules(
  output: IcebreakersOutput,
  groundingFactKeys: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: IcebreakerRejectionReason } {
  const seenTypes = new Set(output.openers.map((opener) => opener.type));
  if (seenTypes.size !== 3) return { ok: false, reason: "WRONG_TYPE_SET" };

  for (const opener of output.openers) {
    // §12.5: "never invent a shared experience / never claim to have
    // read something that isn't in the grounding set" — every cited key
    // must be real.
    for (const key of opener.grounded_in) {
      if (!groundingFactKeys.has(key)) return { ok: false, reason: "UNGROUNDED_FACT" };
    }

    const lowerText = opener.text.toLowerCase();
    if (ROMANTIC_PHRASES.some((phrase) => lowerText.includes(phrase)))
      return { ok: false, reason: "ROMANTIC_LANGUAGE" };

    const citesPortfolio = opener.grounded_in.some((key) => key.startsWith("portfolio"));
    if (!citesPortfolio && FLATTERY_PHRASES.some((phrase) => lowerText.includes(phrase)))
      return { ok: false, reason: "UNGROUNDED_FLATTERY" };
  }

  return { ok: true };
}

export interface IcebreakersResult {
  status: "ok" | "unavailable";
  openers?: { type: IcebreakerType; text: string }[];
}

@Injectable()
export class IcebreakersService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly gateway: AiGatewayService,
  ) {}

  // §12.5's exact grounding-fact list. Built entirely from data the
  // viewer is already entitled to see via GET /profiles/:userId (§12.1's
  // own privacy principle) — never a raw DB query bypassing that
  // visibility check.
  private async buildGroundingFacts(
    viewerId: string,
    candidateId: string,
  ): Promise<GroundingFacts> {
    const [viewer, candidate] = await Promise.all([
      this.profileService.getMyProfile(viewerId),
      this.profileService.getProfileForViewer(viewerId, candidateId),
    ]);

    const viewerSkills = new Set(viewer.skills.map((skill) => skill.name.toLowerCase()));
    const sharedSkills = candidate.skills
      .filter((skill) => viewerSkills.has(skill.name.toLowerCase()))
      .map((skill) => skill.name);
    const viewerInterests = new Set(viewer.interests.map((interest) => interest.toLowerCase()));
    const sharedInterests = candidate.interests.filter((interest) =>
      viewerInterests.has(interest.toLowerCase()),
    );
    const mostRecentExperience = candidate.experience[0] ?? null;

    const facts: GroundingFacts = {
      viewer_primary_intent: viewer.intents[0]?.type ?? null,
      viewer_primary_intent_detail: viewer.intents[0]?.detail ?? null,
      candidate_primary_intent: candidate.intents[0]?.type ?? null,
      candidate_primary_intent_detail: candidate.intents[0]?.detail ?? null,
      shared_skills: sharedSkills,
      shared_interests: sharedInterests,
      mutual_connections_count: candidate.mutual_connections.count,
      candidate_recent_experience_title: mostRecentExperience?.title ?? null,
      candidate_recent_experience_company: mostRecentExperience?.company ?? null,
      candidate_industry: candidate.industry?.label ?? null,
      location_relationship: candidate.location.distance_bucket,
    };
    candidate.portfolio.forEach((item, index) => {
      facts[`portfolio_${index}_title`] = item.title;
    });
    return facts;
  }

  async generate(authContext: AuthContext, candidateId: string): Promise<IcebreakersResult> {
    if (candidateId === authContext.id) {
      throw new BadRequestAppError(
        "BAD_REQUEST",
        "Can't generate an icebreaker for your own profile.",
      );
    }

    const groundingFacts = await this.buildGroundingFacts(authContext.id, candidateId);
    const groundingFactKeys = new Set(Object.keys(groundingFacts));

    const result = await this.gateway.invoke({
      userId: authContext.id,
      plan: authContext.plan,
      feature: "icebreakers",
      tier: "large",
      systemInstructions: ICEBREAKER_SYSTEM_INSTRUCTIONS,
      groundingFacts,
      outputSchema: icebreakersOutputSchema,
      cacheTtlSeconds: 24 * 60 * 60, // §12.2: "24h per (viewer, target, intent)."
      mode: "feature",
    });

    if (result.status !== "ok") return { status: "unavailable" };

    const hardRules = validateIcebreakerHardRules(result.data, groundingFactKeys);
    if (!hardRules.ok) return { status: "unavailable" };

    return {
      status: "ok",
      openers: result.data.openers.map((opener) => ({ type: opener.type, text: opener.text })),
    };
  }

  // §12.5's guardrail: "if AI-drafted first messages exceed 60% of all
  // first messages, reduce suggestion count from 3 to 1." This only
  // emits the counter (a Prometheus metric, same RED-metric convention
  // as matching-expansion-stage) — the >60% threshold check and the
  // resulting behaviour change are an external alerting/config concern,
  // not logic this service computes itself.
  recordFirstMessageSent(aiDrafted: boolean): void {
    aiFirstMessagesTotal.inc({ ai_drafted: String(aiDrafted) });
  }
}

const ICEBREAKER_SYSTEM_INSTRUCTIONS = `You draft three short conversation openers for a professional networking app.
Rules:
- Produce exactly one opener of each type: specific_observation, shared_context, direct_ask.
- Each opener must be grounded only in the structured facts provided — never invent a shared experience, a fact, or something you "read" that isn't in the facts.
- List which fact keys each opener actually used in its own grounded_in array.
- No flattery unless citing a real portfolio item. Nothing that could read as romantic interest. Never reference sensitive attributes.
- Each opener is ≤ 320 characters.
- If the viewer's intent implies a specific ask, include it explicitly in the direct_ask opener.`;
