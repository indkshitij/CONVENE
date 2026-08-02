import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TooManyRequestsAppError } from "../errors/app-error";
import { uuidv7 } from "../utils/uuidv7";
import { rateLimitKey } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import { RATE_LIMIT_METADATA_KEY, type RateLimitDecoratorOptions } from "./rate-limit.decorator";
import { RATE_LIMIT_POLICIES, type RateLimitKeyDimension, type RateLimitPolicy } from "./policies";
import { evalSlidingWindow, type SlidingWindowResult } from "./sliding-window";

interface RateLimitRequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  userId?: string;
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}
interface RateLimitResponseLike {
  setHeader(name: string, value: string): void;
}

// PRD §21.9: "If Redis is unavailable, fail closed to conservative
// in-process limits." A quarter of the Redis-window limit, enforced
// per-process — deliberately stricter than the real limit, since every API
// replica independently enforcing the *full* limit would, in aggregate
// across N replicas, be MORE permissive than intended during an outage.
const IN_PROCESS_FALLBACK_DIVISOR = 4;

// PRD P3.4: implements the §17.6 rate-limit matrix once, applied
// declaratively via @RateLimit({ scope }). Global (APP_GUARD in
// common.module.ts) so it's a no-op for any route without the decorator,
// and enforced without per-controller wiring for any route that has it.
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly inProcessLog = new Map<string, number[]>();

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitDecoratorOptions | undefined>(
      RATE_LIMIT_METADATA_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const policy = RATE_LIMIT_POLICIES[options.scope];
    const request = context.switchToHttp().getRequest<RateLimitRequestLike>();
    const response = context.switchToHttp().getResponse<RateLimitResponseLike>();

    const key = rateLimitKey(options.scope, this.buildCompositeKeyPart(policy, request));
    const nowMs = Date.now();
    const windowMs = policy.windowSeconds * 1000;

    const result = await this.check(key, nowMs, windowMs, policy);

    response.setHeader("X-RateLimit-Limit", String(policy.limit));
    response.setHeader("X-RateLimit-Remaining", String(Math.max(0, policy.limit - result.count)));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil((nowMs + windowMs) / 1000)));

    if (!result.allowed) {
      response.setHeader("Retry-After", String(policy.windowSeconds));
      throw new TooManyRequestsAppError("TOO_MANY_REQUESTS", "Too many requests.", {
        retryAfter: policy.windowSeconds,
      });
    }

    return true;
  }

  private async check(
    key: string,
    nowMs: number,
    windowMs: number,
    policy: RateLimitPolicy,
  ): Promise<SlidingWindowResult> {
    try {
      return await evalSlidingWindow(
        this.redis.client,
        key,
        nowMs,
        windowMs,
        policy.limit,
        uuidv7(),
      );
    } catch {
      return this.checkInProcess(key, nowMs, windowMs, policy);
    }
  }

  private checkInProcess(
    key: string,
    nowMs: number,
    windowMs: number,
    policy: RateLimitPolicy,
  ): SlidingWindowResult {
    const fallbackLimit = Math.max(1, Math.floor(policy.limit / IN_PROCESS_FALLBACK_DIVISOR));
    const timestamps = (this.inProcessLog.get(key) ?? []).filter(
      (timestamp) => timestamp > nowMs - windowMs,
    );

    if (timestamps.length >= fallbackLimit) {
      this.inProcessLog.set(key, timestamps);
      return { allowed: false, count: timestamps.length };
    }

    timestamps.push(nowMs);
    this.inProcessLog.set(key, timestamps);
    return { allowed: true, count: timestamps.length };
  }

  private buildCompositeKeyPart(policy: RateLimitPolicy, request: RateLimitRequestLike): string {
    return policy.keyDimensions
      .map((dimension) => `${dimension}=${this.extractDimensionValue(dimension, request)}`)
      .join(",");
  }

  private extractDimensionValue(
    dimension: RateLimitKeyDimension,
    request: RateLimitRequestLike,
  ): string {
    switch (dimension) {
      case "ip": {
        const forwarded = request.headers["x-forwarded-for"];
        const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        return request.ip ?? forwardedIp ?? "unknown-ip";
      }
      case "user": {
        if (!request.userId) {
          throw new Error(
            "RateLimitGuard: policy requires a 'user' key but request.userId is not set.",
          );
        }
        return request.userId;
      }
      case "identifier": {
        const identifier = request.body?.identifier ?? request.body?.email ?? request.body?.phone;
        if (typeof identifier !== "string") {
          throw new Error(
            "RateLimitGuard: policy requires an 'identifier' key but none was found on the request body.",
          );
        }
        return identifier;
      }
      case "conversation": {
        const conversationId = request.params?.conversationId;
        if (!conversationId) {
          throw new Error(
            "RateLimitGuard: policy requires a 'conversation' key but request.params.conversationId is not set.",
          );
        }
        return conversationId;
      }
    }
  }
}
