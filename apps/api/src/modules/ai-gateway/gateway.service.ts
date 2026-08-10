import { aiUsageLogs } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import type { z } from "zod";
import { type Clock, systemClock } from "../../common/clock";
import { TooManyRequestsAppError } from "../../common/errors/app-error";
import { aiCacheKey } from "../../infra/redis/keys";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { RedisService } from "../../infra/redis/redis.service";
import { buildPrompt, type GroundingFacts } from "./prompt-builder";
import { validateAiOutput } from "./output-validator";
import { type AiFeature, AiQuotaService } from "./quota.service";
import { type AiModelTier, AiRouterService } from "./router.service";

const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60; // §12.2's most common cache window ("24h"); callers may override per feature.

export interface AiInvokeInput<T> {
  userId: string;
  plan: string;
  feature: AiFeature;
  tier: AiModelTier;
  systemInstructions: string;
  groundingFacts: GroundingFacts;
  untrustedUserContent?: string[] | undefined;
  outputSchema: z.ZodType<T>;
  cacheTtlSeconds?: number | undefined;
  // §12.1: "Fail open on features, fail closed on safety." A feature
  // (icebreakers, profile optimisation, ...) degrades to "unavailable"
  // so the caller shows a curated fallback. A safety classifier
  // (toxicity, spam, fake-profile) degrades to "held_for_review" so the
  // content is never silently published unchecked. Defaults to
  // "feature" — safety call sites must opt in explicitly, never the
  // reverse, so a missing flag can't accidentally publish unreviewed
  // content.
  mode?: "feature" | "safety" | undefined;
}

export type AiInvokeResult<T> =
  | { status: "ok"; data: T; cached: boolean }
  | { status: "unavailable" }
  | { status: "held_for_review" };

interface AuditEntry {
  userId: string;
  feature: string;
  model: string;
  tokensUsed: number | null;
  cached: boolean;
}

@Injectable()
export class AiGatewayService {
  constructor(
    private readonly quota: AiQuotaService,
    private readonly router: AiRouterService,
    private readonly redis: RedisService,
    private readonly postgres: PostgresService,
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  // Pipeline: quota -> prompt builder -> cache -> model router -> output
  // validator -> cache write + audit — §12.1's own diagram, in order.
  async invoke<T>(input: AiInvokeInput<T>): Promise<AiInvokeResult<T>> {
    const now = this.clock.now();

    const abuseOk = await this.quota.checkAbuseCap(input.userId, now);
    if (!abuseOk) {
      throw new TooManyRequestsAppError(
        "AI_ABUSE_LIMIT",
        "Too many AI requests this hour. Try again shortly.",
        { retryAfter: 3600 },
      );
    }

    const monthly = await this.quota.checkMonthlyQuota(
      input.userId,
      input.feature,
      input.plan,
      now,
    );
    if (!monthly.allowed) {
      throw new TooManyRequestsAppError(
        "AI_QUOTA_EXCEEDED",
        "You've used all your AI credits for this feature this month.",
        {
          retryAfter: Math.max(0, Math.floor((monthly.resetsAt.getTime() - now.getTime()) / 1000)),
          details: {
            resets_at: monthly.resetsAt.toISOString(),
            limit: monthly.limit,
            upgrade_available: input.plan === "free",
          },
        },
      );
    }

    const { prompt, groundingHash } = buildPrompt({
      feature: input.feature,
      systemInstructions: input.systemInstructions,
      groundingFacts: input.groundingFacts,
      untrustedUserContent: input.untrustedUserContent,
    });

    const cacheKey = aiCacheKey(input.feature, groundingHash);
    const cachedRaw = await this.redis.client.get(cacheKey);
    if (cachedRaw !== null) {
      const validatedCache = validateAiOutput(input.outputSchema, cachedRaw);
      if (validatedCache.ok) {
        await this.audit({
          userId: input.userId,
          feature: input.feature,
          model: "cache",
          tokensUsed: null,
          cached: true,
        });
        return { status: "ok", data: validatedCache.data, cached: true };
      }
      // A corrupted/stale cache entry never gets served — fall through
      // to a fresh call rather than returning garbage.
    }

    const routed = await this.router.route(input.feature, input.tier, prompt);
    if (!routed) {
      await this.audit({
        userId: input.userId,
        feature: input.feature,
        model: input.tier,
        tokensUsed: null,
        cached: false,
      });
      return this.degradedResult(input.mode);
    }

    const validated = validateAiOutput(input.outputSchema, routed.result.output);
    if (!validated.ok) {
      await this.audit({
        userId: input.userId,
        feature: input.feature,
        model: routed.model,
        tokensUsed: routed.result.tokensIn + routed.result.tokensOut,
        cached: false,
      });
      return this.degradedResult(input.mode);
    }

    await this.redis.client.set(
      cacheKey,
      JSON.stringify(validated.data),
      "EX",
      input.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
    );
    await this.audit({
      userId: input.userId,
      feature: input.feature,
      model: routed.model,
      tokensUsed: routed.result.tokensIn + routed.result.tokensOut,
      cached: false,
    });
    return { status: "ok", data: validated.data, cached: false };
  }

  private degradedResult<T>(mode: AiInvokeInput<T>["mode"]): AiInvokeResult<T> {
    return mode === "safety" ? { status: "held_for_review" } : { status: "unavailable" };
  }

  // §12.12: "records metadata only — never prompt or output content."
  // The row shape below is the whole audit contract: feature/model/
  // tokens/cached. There is no column here a prompt or output string
  // could even be assigned to.
  private async audit(entry: AuditEntry): Promise<void> {
    await this.postgres.db.insert(aiUsageLogs).values({
      userId: entry.userId,
      feature: entry.feature,
      model: entry.model,
      tokensUsed: entry.tokensUsed,
      cached: entry.cached,
    });
  }
}
