import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AuthContext } from "../../../common/auth/auth-context";
import { ProfileService } from "../../profile/profile.service";
import { AiGatewayService } from "../gateway.service";
import type { GroundingFacts } from "../prompt-builder";

// §12.11's exact refusal list, checked deterministically against the
// user's own question *before* the model is ever called — "it does not
// give legal, immigration, tax, medical, or investment advice" is
// enforced server-side this way, not left to the prompt alone (the same
// "never merely prompted" standard P25.2's hard-rule validators set).
const REFUSED_TOPIC_PATTERNS: { topic: string; pattern: RegExp }[] = [
  {
    topic: "legal",
    pattern:
      /\b(lawsuit|sue|legal advice|contract dispute|attorney|non-?compete enforceability)\b/i,
  },
  {
    topic: "immigration",
    pattern:
      /\b(visa|green card|immigration|work permit|h-?1b|sponsorship (?:for )?(?:visa|immigration))\b/i,
  },
  { topic: "tax", pattern: /\b(tax (?:advice|filing|deduction)|file my taxes|tax bracket)\b/i },
  {
    topic: "medical",
    pattern: /\b(diagnos|medication|symptoms of|medical advice|is this a health)\b/i,
  },
  {
    topic: "investment",
    pattern:
      /\b(which stocks?|invest my (?:money|savings)|portfolio allocation|buy (?:crypto|bitcoin)|investment advice)\b/i,
  },
];

// A narrow, deliberately low-precision distress check — same
// "false positive costs a support message, false negative costs real
// safety" trade-off as toxicity-spam-classifier.service.ts's self-harm
// threshold, applied here to the user's own question before any career
// content is generated.
const DISTRESS_PATTERNS =
  /\b(want to die|kill myself|end it all|not worth living|no reason to (?:live|go on))\b/i;

const careerGuidanceOutputSchema = z
  .object({
    answer: z.string().min(1).max(2000),
    grounded_in: z.array(z.string()),
  })
  .strict();

export type CareerGuidanceOutput = z.infer<typeof careerGuidanceOutputSchema>;

export type CareerGuidanceResult =
  | { status: "ok"; data: CareerGuidanceOutput }
  | { status: "unavailable" }
  | { status: "refused"; topic: string; message: string }
  | { status: "distress_support"; message: string };

const REFUSAL_MESSAGE = (topic: string) =>
  `I can't give ${topic} advice — that needs a licensed professional. Happy to help with the career angle here if there is one, though.`;

const DISTRESS_MESSAGE =
  "It sounds like things might be really hard right now. I'm not able to help with that here, but support is available: in India, call AASRA at +91-9820466726, or reach a crisis line in your area. If you want, we can come back to the career question whenever you're ready.";

export type CareerGuidanceRejectionReason = "UNGROUNDED_FACT";

export function validateCareerGuidanceHardRules(
  output: CareerGuidanceOutput,
  groundingFactKeys: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: CareerGuidanceRejectionReason } {
  for (const key of output.grounded_in) {
    if (!groundingFactKeys.has(key)) return { ok: false, reason: "UNGROUNDED_FACT" };
  }
  return { ok: true };
}

// §12.11: "a bounded conversational surface ... grounded in the user's
// profile and the platform's aggregate anonymised data ... tool access
// is read-only and scoped to the requesting user's own data." The last
// clause is structurally true here the same way it is for every other
// AI feature — AiModelProvider (router.service.ts) has exactly one
// method, `generate(prompt) -> text`, and no tool-invocation surface at
// all for any feature to grant broader access through.
@Injectable()
export class CareerGuidanceService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly gateway: AiGatewayService,
  ) {}

  async ask(authContext: AuthContext, question: string): Promise<CareerGuidanceResult> {
    if (DISTRESS_PATTERNS.test(question))
      return { status: "distress_support", message: DISTRESS_MESSAGE };

    for (const { topic, pattern } of REFUSED_TOPIC_PATTERNS) {
      if (pattern.test(question))
        return { status: "refused", topic, message: REFUSAL_MESSAGE(topic) };
    }

    const profile = await this.profileService.getMyProfile(authContext.id);
    const groundingFacts: GroundingFacts = {
      industry: profile.industry?.label ?? null,
      job_title: profile.job_title ?? null,
      years_experience: profile.years_experience,
      skills: profile.skills.map((skill) => skill.name),
      intents: profile.intents.map((intent) => intent.type),
    };
    const groundingFactKeys = new Set(Object.keys(groundingFacts));

    const result = await this.gateway.invoke({
      userId: authContext.id,
      plan: authContext.plan,
      feature: "career_guidance",
      tier: "large",
      systemInstructions: CAREER_GUIDANCE_SYSTEM_INSTRUCTIONS,
      groundingFacts,
      untrustedUserContent: [question],
      outputSchema: careerGuidanceOutputSchema,
      cacheTtlSeconds: 60 * 60, // Questions are ad hoc and rarely repeat verbatim — a short cache only guards against accidental double-submits.
      mode: "feature",
    });

    if (result.status !== "ok") return { status: "unavailable" };

    const hardRules = validateCareerGuidanceHardRules(result.data, groundingFactKeys);
    if (!hardRules.ok) return { status: "unavailable" };

    return { status: "ok", data: result.data };
  }
}

const CAREER_GUIDANCE_SYSTEM_INSTRUCTIONS = `You answer career questions for a professional networking platform: career paths, skill sequencing, interview preparation, and market context.
Rules:
- Ground every claim in the structured facts provided; cite which fact keys you used in grounded_in.
- Never evaluate a specific named employer's reputation.
- Never claim certainty about a hiring outcome.
- Do not give legal, immigration, tax, medical, or investment advice — if the question edges into one of these, redirect to the career-adjacent angle instead.
- Every response is labelled AI-generated by the caller, not by you — don't add your own disclaimer text.`;
