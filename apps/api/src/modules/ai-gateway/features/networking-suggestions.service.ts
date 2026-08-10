import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AuthContext } from "../../../common/auth/auth-context";
import { ProfileService } from "../../profile/profile.service";
import { AiGatewayService } from "../gateway.service";
import type { GroundingFacts } from "../prompt-builder";

// §12.6: "Weekly batch job per active user producing: 3 people to reach
// out to (with reasons and a suggested opener), 1 intent adjustment,
// 1 availability nudge, 1 profile action ... delivered as an email
// digest and a Home card." This service builds the real content
// on-demand (the Home-card read path) rather than as a scheduled batch
// — the weekly cron/email-digest half (§12.12: "batched 200 users per
// job with concurrency limits") is a distinct worker-infrastructure
// build this pass doesn't include (no digest-email template exists
// either, see notifications/email.service.ts's own scope). Flagged as a
// reduced-scope choice, not silently dropped: the generation logic
// itself, including the anti-fabrication grounding-citation rule every
// other feature in this module uses, is real.
const suggestedContactSchema = z
  .object({
    candidate_id: z.string(),
    reason: z.string().max(200),
    suggested_opener: z.string().max(320),
    grounded_in: z.array(z.string()),
  })
  .strict();

export const networkingSuggestionsOutputSchema = z
  .object({
    contacts: z.array(suggestedContactSchema).length(3),
    intent_adjustment: z.string().max(300).nullable(),
    availability_nudge: z.string().max(300).nullable(),
    profile_action: z.string().max(300),
  })
  .strict();

export type NetworkingSuggestionsOutput = z.infer<typeof networkingSuggestionsOutputSchema>;

export interface NetworkingSuggestionsResult {
  status: "ok" | "unavailable";
  data?: NetworkingSuggestionsOutput;
}

const mentorRationaleSchema = z
  .object({
    candidate_id: z.string(),
    rationale: z.string().max(200),
    grounded_in: z.array(z.string()),
  })
  .strict();
export const mentorRecommendationsOutputSchema = z
  .object({ recommendations: z.array(mentorRationaleSchema).max(5) })
  .strict();
export type MentorRecommendationsOutput = z.infer<typeof mentorRecommendationsOutputSchema>;

export interface MentorRecommendationsResult {
  status: "ok" | "unavailable";
  data?: MentorRecommendationsOutput;
}

function validateGrounded(groundedIn: string[], groundingFactKeys: ReadonlySet<string>): boolean {
  return groundedIn.every((key) => groundingFactKeys.has(key));
}

@Injectable()
export class NetworkingSuggestionsService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly gateway: AiGatewayService,
  ) {}

  // `candidateIds` is caller-supplied (the controller resolves this from
  // the existing discovery feed / top-matches read path — see
  // ai.controller.ts) rather than this service re-implementing candidate
  // selection, which packages/matching + the discovery module already
  // own.
  async suggestContacts(
    authContext: AuthContext,
    candidateIds: string[],
  ): Promise<NetworkingSuggestionsResult> {
    const [viewer, candidates] = await Promise.all([
      this.profileService.getMyProfile(authContext.id),
      Promise.all(
        candidateIds
          .slice(0, 5)
          .map((id) => this.profileService.getProfileForViewer(authContext.id, id)),
      ),
    ]);

    const groundingFacts: GroundingFacts = {
      viewer_primary_intent: viewer.intents[0]?.type ?? null,
      viewer_active_intents: viewer.intents.map((intent) => intent.type),
    };
    candidates.forEach((candidate, index) => {
      groundingFacts[`candidate_${index}_id`] = candidateIds[index];
      groundingFacts[`candidate_${index}_intent`] = candidate.intents[0]?.type ?? null;
      groundingFacts[`candidate_${index}_headline`] = candidate.headline;
    });
    const groundingFactKeys = new Set(Object.keys(groundingFacts));

    const result = await this.gateway.invoke({
      userId: authContext.id,
      plan: authContext.plan,
      feature: "networking_suggestions",
      tier: "large",
      systemInstructions: NETWORKING_SUGGESTIONS_INSTRUCTIONS,
      groundingFacts,
      outputSchema: networkingSuggestionsOutputSchema,
      cacheTtlSeconds: 7 * 24 * 60 * 60, // §12.2: "7d."
      mode: "feature",
    });

    if (result.status !== "ok") return { status: "unavailable" };
    const allGrounded = result.data.contacts.every((contact) =>
      validateGrounded(contact.grounded_in, groundingFactKeys),
    );
    if (!allGrounded) return { status: "unavailable" };

    return { status: "ok", data: result.data };
  }

  // §12.6: "Mentor recommendations run the standard matching engine
  // restricted to need_mentee holders, then add an LLM-generated
  // rationale of <= 200 characters." Same division of labour as
  // suggestContacts — `mentorCandidateIds` is the already-restricted-to-
  // need_mentee list the caller resolves via the real matching engine;
  // this only generates the rationale text.
  async mentorRationales(
    authContext: AuthContext,
    mentorCandidateIds: string[],
  ): Promise<MentorRecommendationsResult> {
    const candidates = await Promise.all(
      mentorCandidateIds
        .slice(0, 5)
        .map((id) => this.profileService.getProfileForViewer(authContext.id, id)),
    );

    const groundingFacts: GroundingFacts = {};
    candidates.forEach((candidate, index) => {
      groundingFacts[`candidate_${index}_id`] = mentorCandidateIds[index];
      groundingFacts[`candidate_${index}_experience_title`] =
        candidate.experience[0]?.title ?? null;
      groundingFacts[`candidate_${index}_skills`] = candidate.skills.map((skill) => skill.name);
    });
    const groundingFactKeys = new Set(Object.keys(groundingFacts));

    const result = await this.gateway.invoke({
      userId: authContext.id,
      plan: authContext.plan,
      feature: "mentor_recommendations",
      tier: "large",
      systemInstructions: MENTOR_RATIONALE_INSTRUCTIONS,
      groundingFacts,
      outputSchema: mentorRecommendationsOutputSchema,
      cacheTtlSeconds: 7 * 24 * 60 * 60,
      mode: "feature",
    });

    if (result.status !== "ok") return { status: "unavailable" };
    const allGrounded = result.data.recommendations.every((entry) =>
      validateGrounded(entry.grounded_in, groundingFactKeys),
    );
    if (!allGrounded) return { status: "unavailable" };

    return { status: "ok", data: result.data };
  }
}

const NETWORKING_SUGGESTIONS_INSTRUCTIONS = `You produce a weekly networking digest for a professional networking platform.
From the provided candidates, pick exactly 3 and explain why each is worth reaching out to (<=200 chars) plus a suggested opener (<=320 chars) — ground every claim in the provided facts, citing which fact keys you used.
Also suggest: one intent adjustment (or null if none is warranted), one availability nudge (or null), and one profile-improvement action.
Never invent a fact about a candidate not in the grounding data.`;

const MENTOR_RATIONALE_INSTRUCTIONS = `For each candidate (already filtered to mentee-seekers by the matching engine), write a rationale (<=200 chars) explaining the specific fit, grounded only in the provided facts — cite which fact keys you used.`;
