import { Injectable } from "@nestjs/common";
import { RATE_LIMIT_POLICIES } from "../../common/rate-limit/policies";
import { evalSlidingWindow } from "../../common/rate-limit/sliding-window";
import { aiMonthlyQuotaKey, rateLimitKey } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";

// §12.2's Feature Catalogue "Free quota" column, transcribed verbatim.
// Icebreakers and Introduction Message share one pool (10/mo total, not
// 10 each — the table's own "(shared with #3)" note on row 4). Premium-
// only features (conversation summary) get a 0 free-plan limit here —
// the gateway still runs the same quota check, it just always denies at
// zero for `plan==="free"` rather than needing a separate gate.
export const AI_FEATURES = {
  profile_optimisation: "profile_optimisation",
  resume_review: "resume_review",
  icebreakers: "icebreakers", // Also covers "introduction_message" — same pool.
  networking_suggestions: "networking_suggestions",
  mentor_recommendations: "mentor_recommendations",
  compatibility_explanation: "compatibility_explanation",
  conversation_summary: "conversation_summary",
  career_guidance: "career_guidance",
  // §12.2 rows 9/11: "Always on," i.e. every message, never user-quota-
  // gated (a per-user monthly cap would let a user "run out" of spam/
  // toxicity protection, which defeats the point) — Infinity below, not
  // omitted, so audit rows still carry the real feature name instead of
  // being mislabelled under an unrelated feature just to reuse its bucket.
  toxicity_detection: "toxicity_detection",
  spam_detection: "spam_detection",
} as const;

export type AiFeature = (typeof AI_FEATURES)[keyof typeof AI_FEATURES];

const FREE_MONTHLY_LIMITS: Record<AiFeature, number> = {
  profile_optimisation: 2,
  resume_review: 1,
  icebreakers: 10,
  networking_suggestions: Number.POSITIVE_INFINITY, // "Weekly, all plans" — not plan-gated.
  mentor_recommendations: Number.POSITIVE_INFINITY, // "Weekly" — not plan-gated.
  compatibility_explanation: 20,
  conversation_summary: 0, // "Premium only."
  career_guidance: 3,
  toxicity_detection: Number.POSITIVE_INFINITY,
  spam_detection: Number.POSITIVE_INFINITY,
};

// Premium/Pro get 5x the free allowance except for the two always-weekly
// features (already unlimited) and conversation summary, which flips
// from 0 (free) to unlimited (Premium) rather than scaling — no PRD
// table gives an exact Premium numeric cap for career_guidance/
// icebreakers/etc beyond "Premium only" for #8, so 5x is a documented,
// generous-but-bounded choice, not a transcription.
const PREMIUM_MULTIPLIER = 5;

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  resetsAt: Date;
}

function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function secondsUntilNextUtcMonth(now: Date): number {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(60, Math.floor((nextMonth.getTime() - now.getTime()) / 1000));
}

@Injectable()
export class AiQuotaService {
  constructor(private readonly redis: RedisService) {}

  private limitFor(feature: AiFeature, plan: string): number {
    const base = FREE_MONTHLY_LIMITS[feature];
    if (!Number.isFinite(base)) return base;
    if (feature === "conversation_summary") return plan === "free" ? 0 : Number.POSITIVE_INFINITY;
    return plan === "free" ? base : base * PREMIUM_MULTIPLIER;
  }

  // §12.12: "Rate limit 20 AI calls/hour/user regardless of plan" — the
  // one cap every feature shares, evaluated before the per-feature
  // monthly quota. Reuses the "ai-features" sliding-window policy
  // already declared in rate-limit/policies.ts for exactly this purpose.
  async checkAbuseCap(userId: string, now: Date): Promise<boolean> {
    const policy = RATE_LIMIT_POLICIES["ai-features"];
    const result = await evalSlidingWindow(
      this.redis.client,
      rateLimitKey("ai-features", userId),
      now.getTime(),
      policy.windowSeconds * 1000,
      policy.limit,
      `${now.getTime()}-${Math.random()}`,
    );
    return result.allowed;
  }

  // §12.12: "Per user per calendar month, per feature." Redis INCR +
  // EXPIRE keyed to the UTC calendar month — same rollback-on-denial
  // shape as ConnectionQuotaService.checkDailyQuota (a rejected call
  // must not consume quota).
  async checkMonthlyQuota(
    userId: string,
    feature: AiFeature,
    plan: string,
    now: Date,
  ): Promise<QuotaCheckResult> {
    const limit = this.limitFor(feature, plan);
    const resetsAt = new Date(now.getTime() + secondsUntilNextUtcMonth(now) * 1000);
    if (!Number.isFinite(limit)) return { allowed: true, used: 0, limit, resetsAt };

    const key = aiMonthlyQuotaKey(userId, feature, monthKey(now));
    const used = await this.redis.client.incr(key);
    if (used === 1) await this.redis.client.expire(key, secondsUntilNextUtcMonth(now));

    if (used > limit) {
      await this.redis.client.decr(key);
      return { allowed: false, used: limit, limit, resetsAt };
    }
    return { allowed: true, used, limit, resetsAt };
  }
}
