import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { AiGatewayService } from "../../ai-gateway/gateway.service";
import type { GroundingFacts } from "../../ai-gateway/prompt-builder";

// §12.10's six labels. `self_harm_risk_to_self` is deliberately the only
// self-harm concept modelled — §12.10's own text: "if a message
// indicates the author may be at risk, no punitive action is taken."
// "Self-harm directed at another" (a threat toward someone else, the
// table's other self-harm row) is captured by the `threats` label
// instead, which already routes through the normal severe-enforcement
// path — there's no second, threat-shaped self-harm signal to model.
const classificationOutputSchema = z
  .object({
    harassment: z.number().min(0).max(1),
    hate: z.number().min(0).max(1),
    sexual_content: z.number().min(0).max(1),
    threats: z.number().min(0).max(1),
    self_harm_risk_to_self: z.number().min(0).max(1),
    severe_profanity: z.number().min(0).max(1),
    spam_probability: z.number().min(0).max(1),
  })
  .strict();

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

export type ToxicityOutcome =
  | { kind: "clean" }
  | { kind: "self_harm_support" } // §12.10: never punitive — support resources + trained-reviewer routing, handled entirely outside the enforcement ladder.
  | { kind: "borderline"; label: string }
  | { kind: "violating"; label: string }
  | { kind: "severe"; label: string }
  | { kind: "held_for_review" }; // §12.1 fail-closed-on-safety: the classifier itself was unavailable/rejected — never silently "clean".

export type SpamAction = "deliver" | "deliver_and_flag" | "deliver_and_throttle" | "hold";

export interface ClassificationResult {
  toxicity: ToxicityOutcome;
  spamAction: SpamAction;
  spamScore: number | null;
}

const SELF_HARM_THRESHOLD = 0.3; // Deliberately low — false positives here cost a support message, false negatives cost real safety.
const SEVERE_THRESHOLD = 0.85;
const VIOLATING_THRESHOLD = 0.65;
const BORDERLINE_THRESHOLD = 0.35;
// harassment/hate/threats are "more sensitive than profanity" (§12.10) —
// a lower severe/violating bar for those three than for plain swearing.
const SENSITIVE_LABELS = new Set(["harassment", "hate", "threats"]);

function bandForLabel(label: string, score: number): ToxicityOutcome["kind"] | null {
  const severeThreshold = SENSITIVE_LABELS.has(label) ? SEVERE_THRESHOLD - 0.1 : SEVERE_THRESHOLD;
  const violatingThreshold = SENSITIVE_LABELS.has(label)
    ? VIOLATING_THRESHOLD - 0.1
    : VIOLATING_THRESHOLD;
  if (score >= severeThreshold) return "severe";
  if (score >= violatingThreshold) return "violating";
  if (score >= BORDERLINE_THRESHOLD) return "borderline";
  return null;
}

export function spamActionForScore(score: number): SpamAction {
  if (score > 0.85) return "hold";
  if (score > 0.65) return "deliver_and_throttle";
  if (score > 0.35) return "deliver_and_flag";
  return "deliver";
}

@Injectable()
export class ToxicitySpamClassifierService {
  constructor(private readonly gateway: AiGatewayService) {}

  // §12.10's own latency budget (< 120ms) is for the *sync fast-path*
  // (ModerationFastPathService, deterministic regex/rules) — this is the
  // async deep classifier stage (§12.8's "stage 2, < 5s") the fast-path
  // hands off to, using the AI gateway rather than a bespoke model
  // client. `mode: "safety"` is what makes an unavailable classifier
  // fail *closed* (held_for_review) instead of silently delivering.
  async classify(userId: string, plan: string, messageBody: string): Promise<ClassificationResult> {
    const groundingFacts: GroundingFacts = {}; // No profile context needed — classification is purely over the message text itself.

    const result = await this.gateway.invoke({
      userId,
      plan,
      feature: "toxicity_detection", // §12.2 rows 9/11: "Always on" — unlimited quota, see quota.service.ts.
      tier: "small",
      systemInstructions: CLASSIFIER_SYSTEM_INSTRUCTIONS,
      groundingFacts,
      untrustedUserContent: [messageBody],
      outputSchema: classificationOutputSchema,
      cacheTtlSeconds: 60, // Content classification must be near-fresh; a short cache only guards against literal duplicate-message spam bursts.
      mode: "safety",
    });

    if (result.status !== "ok") {
      return { toxicity: { kind: "held_for_review" }, spamAction: "hold", spamScore: null };
    }

    return {
      toxicity: this.toxicityOutcome(result.data),
      spamAction: spamActionForScore(result.data.spam_probability),
      spamScore: result.data.spam_probability,
    };
  }

  private toxicityOutcome(data: ClassificationOutput): ToxicityOutcome {
    if (data.self_harm_risk_to_self >= SELF_HARM_THRESHOLD) return { kind: "self_harm_support" };

    const candidates: [string, number][] = [
      ["harassment", data.harassment],
      ["hate", data.hate],
      ["sexual_content", data.sexual_content],
      ["threats", data.threats],
      ["severe_profanity", data.severe_profanity],
    ];
    let worst: {
      label: string;
      band: Exclude<ToxicityOutcome["kind"], "clean" | "self_harm_support" | "held_for_review">;
      score: number;
    } | null = null;
    for (const [label, score] of candidates) {
      const band = bandForLabel(label, score);
      if (!band || band === "clean") continue;
      if (!worst || score > worst.score) worst = { label, band: band as never, score };
    }
    if (!worst) return { kind: "clean" };
    return { kind: worst.band, label: worst.label } as ToxicityOutcome;
  }
}

const CLASSIFIER_SYSTEM_INSTRUCTIONS = `You classify a single message for a professional networking platform.
Score each of these 0-1: harassment, hate, sexual_content, threats, self_harm_risk_to_self (does the AUTHOR appear to be at risk, not a threat toward someone else), severe_profanity, spam_probability.
This is a professional context where adults may swear casually — reserve severe_profanity for abusive, not merely casual, language.
Score self_harm_risk_to_self based only on whether the author themselves may be in distress — never based on the topic being discussed abstractly (e.g. a career conversation about a stressful layoff is not self-harm risk).`;
