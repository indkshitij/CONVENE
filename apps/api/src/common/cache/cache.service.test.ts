import { describe, expect, it, vi } from "vitest";
import type { Clock } from "../clock";
import { CacheService } from "./cache.service";

function makeRedisFake() {
  const store = new Map<string, string>();
  return {
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK" as const;
      }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    },
  };
}

describe("CacheService", () => {
  it("calls the factory once and serves subsequent calls from the in-process LRU", async () => {
    const redis = makeRedisFake();
    const service = new CacheService(redis as never);
    const factory = vi.fn().mockResolvedValue({ data: "value" });

    const first = await service.getOrSet("key-1", 300, factory);
    const second = await service.getOrSet("key-1", 300, factory);

    expect(first).toEqual({ data: "value" });
    expect(second).toEqual({ data: "value" });
    expect(factory).toHaveBeenCalledOnce();
  });

  it("serves from Redis (without calling the factory) when the local entry has expired but Redis still has it", async () => {
    const redis = makeRedisFake();
    let now = new Date("2026-08-03T00:00:00Z");
    const clock: Clock = { now: () => now };
    const service = new CacheService(redis as never, clock);
    const factory = vi.fn().mockResolvedValue({ data: "value" });

    await service.getOrSet("key-1", 300, factory);
    now = new Date(now.getTime() + 301 * 1000); // past the 300s local TTL, Redis's own TTL is independent

    const result = await service.getOrSet("key-1", 300, factory);
    expect(result).toEqual({ data: "value" });
    expect(factory).toHaveBeenCalledOnce();
  });

  it("recomputes via the factory after both layers miss", async () => {
    const redis = makeRedisFake();
    const service = new CacheService(redis as never);
    const factory = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });

    const first = await service.getOrSet("key-1", 300, factory);
    await service.invalidate("key-1");
    const second = await service.getOrSet("key-1", 300, factory);

    expect(first).toEqual({ v: 1 });
    expect(second).toEqual({ v: 2 });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("invalidate() clears both the local entry and the Redis key", async () => {
    const redis = makeRedisFake();
    const service = new CacheService(redis as never);
    await service.getOrSet("key-1", 300, async () => ({ data: "value" }));

    await service.invalidate("key-1");

    expect(redis.client.del).toHaveBeenCalledWith("key-1");
    expect(await redis.client.get("key-1")).toBeNull();
  });

  it("evicts the least-recently-used local entry once the max size is exceeded", async () => {
    const redis = makeRedisFake();
    const service = new CacheService(redis as never, undefined, 2);

    await service.getOrSet("a", 300, async () => "a-value");
    await service.getOrSet("b", 300, async () => "b-value");
    await service.getOrSet("c", 300, async () => "c-value"); // evicts "a" locally

    const factoryForA = vi.fn().mockResolvedValue("a-recomputed");
    // "a" is gone from the local LRU, but Redis still has it from the
    // first getOrSet call, so this still shouldn't hit the factory.
    const result = await service.getOrSet("a", 300, factoryForA);
    expect(result).toBe("a-value");
    expect(factoryForA).not.toHaveBeenCalled();
  });
});
