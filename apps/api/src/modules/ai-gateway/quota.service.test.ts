import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEvalSlidingWindow = vi.fn();
vi.mock("../../common/rate-limit/sliding-window", () => ({
  evalSlidingWindow: (...args: unknown[]) => mockEvalSlidingWindow(...args),
}));

import { AiQuotaService } from "./quota.service";
import type { RedisService } from "../../infra/redis/redis.service";

function fakeRedisService(): { redis: RedisService; store: Map<string, number> } {
  const store = new Map<string, number>();
  const client = {
    incr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    decr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) - 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
  return { redis: { client } as unknown as RedisService, store };
}

const NOW = new Date("2026-03-15T12:00:00Z");

beforeEach(() => mockEvalSlidingWindow.mockReset());

describe("AiQuotaService.checkMonthlyQuota", () => {
  it("allows calls up to the free-plan limit, then denies without over-counting", async () => {
    const { redis } = fakeRedisService();
    const quota = new AiQuotaService(redis);

    // resume_review free limit is 1/mo.
    const first = await quota.checkMonthlyQuota("u1", "resume_review", "free", NOW);
    expect(first).toMatchObject({ allowed: true, used: 1, limit: 1 });

    const second = await quota.checkMonthlyQuota("u1", "resume_review", "free", NOW);
    expect(second).toMatchObject({ allowed: false, used: 1, limit: 1 });
  });

  it("a denied call does not consume quota — a later successful retry still sees the same used count", async () => {
    const { redis, store } = fakeRedisService();
    const quota = new AiQuotaService(redis);

    await quota.checkMonthlyQuota("u1", "resume_review", "free", NOW);
    await quota.checkMonthlyQuota("u1", "resume_review", "free", NOW);
    await quota.checkMonthlyQuota("u1", "resume_review", "free", NOW);

    const key = [...store.keys()][0]!;
    expect(store.get(key)).toBe(1);
  });

  it("Premium gets a larger allowance than free for the same feature", async () => {
    const { redis } = fakeRedisService();
    const quota = new AiQuotaService(redis);
    const result = await quota.checkMonthlyQuota("u1", "icebreakers", "premium", NOW);
    expect(result.limit).toBe(50); // 10 free * 5x multiplier
  });

  it("conversation_summary is entirely unavailable on the free plan and unlimited on Premium", async () => {
    const { redis } = fakeRedisService();
    const quota = new AiQuotaService(redis);

    const free = await quota.checkMonthlyQuota("u1", "conversation_summary", "free", NOW);
    expect(free).toMatchObject({ allowed: false, limit: 0 });

    const premium = await quota.checkMonthlyQuota("u2", "conversation_summary", "premium", NOW);
    expect(premium).toMatchObject({ allowed: true, limit: Number.POSITIVE_INFINITY });
  });

  it("weekly, always-on features (networking suggestions) are never plan-gated", async () => {
    const { redis } = fakeRedisService();
    const quota = new AiQuotaService(redis);
    const result = await quota.checkMonthlyQuota("u1", "networking_suggestions", "free", NOW);
    expect(result).toMatchObject({ allowed: true, limit: Number.POSITIVE_INFINITY });
  });
});

describe("AiQuotaService.checkAbuseCap", () => {
  it("delegates to the shared 20/hour sliding-window policy", async () => {
    mockEvalSlidingWindow.mockResolvedValue({ allowed: false, count: 21 });
    const { redis } = fakeRedisService();
    const quota = new AiQuotaService(redis);

    const allowed = await quota.checkAbuseCap("u1", NOW);
    expect(allowed).toBe(false);
    expect(mockEvalSlidingWindow).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("ai-features"),
      NOW.getTime(),
      60 * 60 * 1000,
      20,
      expect.any(String),
    );
  });
});
