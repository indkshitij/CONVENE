import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AuthContext } from "../../../common/auth/auth-context";
import { ProfileService } from "../../profile/profile.service";
import { CompletionService } from "../../profile/completion.service";
import { AiGatewayService } from "../gateway.service";
import type { GroundingFacts } from "../prompt-builder";

const priorityActionSchema = z
  .object({
    action: z.string().min(1),
    impact: z.enum(["high", "medium", "low"]),
    effort: z.enum(["high", "medium", "low"]),
  })
  .strict();

// §12.3's exact response shape. `grounded_in` on headline/about (not in
// the PRD's worked example, added here) is what lets the never-fabricate
// rule be checked mechanically — same citation-checking mechanism as
// icebreakers.service.ts, applied to the one other MVP feature that
// shares the same fabrication risk.
export const profileOptimisationOutputSchema = z
  .object({
    overall_score: z.number().int().min(0).max(100),
    headline: z
      .object({
        current: z.string(),
        issue: z.string(),
        suggestions: z.array(z.string().max(120)).min(1).max(3),
        why: z.string(),
        grounded_in: z.array(z.string()),
      })
      .strict(),
    about: z
      .object({
        issues: z.array(z.string()),
        rewrite: z.string().max(2000),
        kept_from_original: z.array(z.string()),
        grounded_in: z.array(z.string()),
      })
      .strict(),
    skills: z
      .object({
        add: z.array(z.string()),
        remove: z.array(z.string()),
        reason: z.string(),
      })
      .strict(),
    intents: z
      .object({
        suggestion: z.string(),
        projected_match_increase: z.string(),
      })
      .strict(),
    priority_actions: z.array(priorityActionSchema).min(1).max(5),
  })
  .strict();

export type ProfileOptimisationOutput = z.infer<typeof profileOptimisationOutputSchema>;

export type ProfileOptimisationRejectionReason = "UNGROUNDED_FACT" | "FABRICATED_SKILL_REMOVAL";

// §12.3: "never fabricate experience, employers, or credentials ... the
// user's own voice is preserved." The headline/about rewrite can only
// cite facts that were actually handed to the model; `skills.remove`
// can only name a skill the user actually has listed (removing a skill
// they never had isn't a fabrication risk exactly, but it's a sign the
// model hallucinated the current-skills list rather than reading it).
export function validateProfileOptimisationHardRules(
  output: ProfileOptimisationOutput,
  groundingFactKeys: ReadonlySet<string>,
  currentSkillNames: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: ProfileOptimisationRejectionReason } {
  for (const key of [...output.headline.grounded_in, ...output.about.grounded_in]) {
    if (!groundingFactKeys.has(key)) return { ok: false, reason: "UNGROUNDED_FACT" };
  }
  for (const skill of output.skills.remove) {
    if (!currentSkillNames.has(skill.toLowerCase()))
      return { ok: false, reason: "FABRICATED_SKILL_REMOVAL" };
  }
  return { ok: true };
}

export interface ProfileOptimisationResult {
  status: "ok" | "unavailable";
  data?: ProfileOptimisationOutput;
}

@Injectable()
export class ProfileOptimisationService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly completionService: CompletionService,
    private readonly gateway: AiGatewayService,
  ) {}

  private async buildGroundingFacts(
    userId: string,
  ): Promise<{ facts: GroundingFacts; skillNames: Set<string> }> {
    const [profile, completion] = await Promise.all([
      this.profileService.getMyProfile(userId),
      this.completionService.getCompletion(userId),
    ]);
    const skillNames = new Set(profile.skills.map((skill) => skill.name.toLowerCase()));

    const facts: GroundingFacts = {
      headline: profile.headline,
      about: profile.about,
      skills: profile.skills.map((skill) => skill.name),
      experience_titles: profile.experience.map((entry) => entry.title),
      industry: profile.industry?.label ?? null,
      intents: profile.intents.map((intent) => intent.type),
      completion_score: completion.score,
      completion_missing: completion.missing.map((entry) => entry.field),
    };
    return { facts, skillNames };
  }

  // §12.3: "2/mo" free quota, "24h per profile-hash" cache — the cache
  // key is the grounding-fact hash (built from the current profile
  // state), so a profile edit naturally busts it without any explicit
  // invalidation code.
  async generate(authContext: AuthContext): Promise<ProfileOptimisationResult> {
    const { facts, skillNames } = await this.buildGroundingFacts(authContext.id);
    const groundingFactKeys = new Set(Object.keys(facts));

    const result = await this.gateway.invoke({
      userId: authContext.id,
      plan: authContext.plan,
      feature: "profile_optimisation",
      tier: "large",
      systemInstructions: PROFILE_OPTIMISATION_SYSTEM_INSTRUCTIONS,
      groundingFacts: facts,
      outputSchema: profileOptimisationOutputSchema,
      cacheTtlSeconds: 24 * 60 * 60,
      mode: "feature",
    });

    if (result.status !== "ok") return { status: "unavailable" };

    const hardRules = validateProfileOptimisationHardRules(
      result.data,
      groundingFactKeys,
      skillNames,
    );
    if (!hardRules.ok) return { status: "unavailable" };

    return { status: "ok", data: result.data };
  }
}

const PROFILE_OPTIMISATION_SYSTEM_INSTRUCTIONS = `You review a professional networking profile and suggest improvements.
Rules:
- Never fabricate experience, employers, credentials, or skills the person doesn't have.
- Preserve the person's own voice and distinctive phrasing; never inflate seniority.
- The headline and about rewrite may only reference facts in the structured grounding data — list which fact keys you used in each section's grounded_in array.
- Only suggest removing a skill that's actually in the provided skills list.
- Every suggestion is a proposal the user accepts or rejects field-by-field — never claim a change has already been made.`;
