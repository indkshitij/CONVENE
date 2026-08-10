import { Inject, Injectable } from "@nestjs/common";
import { aiCircuitBreakerKey } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";

// §12.1's model catalogue: "Small classifier (toxicity/spam)" and "LLM
// (large) generation + reasoning." Only these two tiers exist — routing
// decides which one a feature needs, never which specific vendor model
// (that's the provider's own concern, swapped in at deployment).
export type AiModelTier = "small" | "large";
export const SMALL_MODEL_NAME = "ai-small-classifier";
export const LARGE_MODEL_NAME = "ai-large-generation";

export interface AiModelRequest {
  tier: AiModelTier;
  prompt: string;
}

export interface AiModelResult {
  output: string;
  tokensIn: number;
  tokensOut: number;
}

// The ENTIRE surface a model can act through — one method, string in,
// string out. No tool-calling, no message-send capability exists on this
// interface for any implementation to expose: "The AI can invoke no
// tools and send no messages" (§12.1) is true by construction, not by
// a runtime check.
export interface AiModelProvider {
  generate(request: AiModelRequest): Promise<AiModelResult>;
}

export const AI_MODEL_PROVIDER = "AI_MODEL_PROVIDER";

// Dev/test default — no network call, no API key, deterministic (same
// "swappable provider, stub bound by default" precedent as
// profile/embedding-provider.ts's DeterministicStubEmbeddingProvider).
// Real delivery is a separate AiModelProvider implementation (an
// OpenAI/Anthropic/etc client) wired in by deployment config — not built
// this phase. The stub never inspects `prompt` for instructions — it
// always produces the same shape regardless of content, which is also
// what makes it safe against prompt injection by construction: there is
// nothing in it that could be "convinced" to behave differently.
@Injectable()
export class DeterministicStubAiModelProvider implements AiModelProvider {
  async generate(request: AiModelRequest): Promise<AiModelResult> {
    return {
      output: JSON.stringify({ stub: true, tier: request.tier }),
      tokensIn: Math.ceil(request.prompt.length / 4),
      tokensOut: 8,
    };
  }
}

const REQUEST_TIMEOUT_MS = 8000; // §12.12: "8s timeout, 1 retry with jitter."
const RETRY_ATTEMPTS = 1;
const JITTER_MS = 250;
const CIRCUIT_FAILURE_THRESHOLD = 3; // Consecutive failures before a feature's circuit opens.
const CIRCUIT_COOLDOWN_SECONDS = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("AI_MODEL_TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export interface AiRoutedResult {
  result: AiModelResult;
  model: string;
}

// §12.12 "Degraded mode: Feature-level circuit breaker" — a plain
// consecutive-failure counter in Redis, not a request-count sliding
// window (this is about the model backend being unhealthy, not about
// caller volume, which is quota.service.ts's job). Three consecutive
// failures opens the circuit for a cooldown, during which route()
// returns null immediately without attempting a call — this is the
// mechanism gateway.service.ts's "fail open on features" relies on.
@Injectable()
export class AiRouterService {
  constructor(
    @Inject(AI_MODEL_PROVIDER) private readonly provider: AiModelProvider,
    private readonly redis: RedisService,
  ) {}

  async route(feature: string, tier: AiModelTier, prompt: string): Promise<AiRoutedResult | null> {
    if (await this.isCircuitOpen(feature)) return null;

    for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const result = await withTimeout(
          this.provider.generate({ tier, prompt }),
          REQUEST_TIMEOUT_MS,
        );
        await this.recordSuccess(feature);
        return { result, model: tier === "large" ? LARGE_MODEL_NAME : SMALL_MODEL_NAME };
      } catch {
        if (attempt === RETRY_ATTEMPTS) {
          await this.recordFailure(feature);
          return null;
        }
        await sleep(Math.random() * JITTER_MS);
      }
    }
    return null;
  }

  private async isCircuitOpen(feature: string): Promise<boolean> {
    const raw = await this.redis.client.get(aiCircuitBreakerKey(feature));
    return raw !== null && Number(raw) >= CIRCUIT_FAILURE_THRESHOLD;
  }

  private async recordFailure(feature: string): Promise<void> {
    const key = aiCircuitBreakerKey(feature);
    const count = await this.redis.client.incr(key);
    if (count >= CIRCUIT_FAILURE_THRESHOLD)
      await this.redis.client.expire(key, CIRCUIT_COOLDOWN_SECONDS);
    else await this.redis.client.expire(key, CIRCUIT_COOLDOWN_SECONDS * CIRCUIT_FAILURE_THRESHOLD);
  }

  private async recordSuccess(feature: string): Promise<void> {
    await this.redis.client.del(aiCircuitBreakerKey(feature));
  }
}
