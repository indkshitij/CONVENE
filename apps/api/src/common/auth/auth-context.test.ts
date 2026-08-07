import { describe, expect, it, vi } from "vitest";
import { AuthContextService } from "./auth-context";

function makeRedisFake() {
  const store = new Map<string, string>();
  return {
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string, ..._rest: unknown[]) => {
        store.set(key, value);
        return "OK" as const;
      }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    },
  };
}

function makePostgresFake(user: Record<string, unknown> | undefined) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (user ? [user] : []),
          }),
        }),
      }),
    },
  };
}

// PRD §17.4: "Auth context cached in Redis for 60s (id, role, plan,
// status, token version)."
describe("AuthContextService", () => {
  it("builds a context from the DB on a cache miss and caches it", async () => {
    const redis = makeRedisFake();
    const postgres = makePostgresFake({
      id: "user-1",
      role: "user",
      status: "active",
      tokenVersion: 3,
    });
    const service = new AuthContextService(postgres as never, redis as never);

    const context = await service.get("user-1");

    expect(context).toEqual({
      id: "user-1",
      role: "user",
      plan: "free",
      status: "active",
      tokenVersion: 3,
      shadowLimited: false,
    });
    expect(redis.client.set).toHaveBeenCalledOnce();
  });

  it("marks shadowLimited when the user's status is shadow_limited", async () => {
    const redis = makeRedisFake();
    const postgres = makePostgresFake({
      id: "user-1",
      role: "user",
      status: "shadow_limited",
      tokenVersion: 0,
    });
    const service = new AuthContextService(postgres as never, redis as never);

    const context = await service.get("user-1");
    expect(context?.shadowLimited).toBe(true);
  });

  it("returns null for a user that doesn't exist", async () => {
    const redis = makeRedisFake();
    const postgres = makePostgresFake(undefined);
    const service = new AuthContextService(postgres as never, redis as never);

    expect(await service.get("missing-user")).toBeNull();
  });

  it("serves from the Redis cache on a hit without querying Postgres", async () => {
    const redis = makeRedisFake();
    const selectSpy = vi.fn();
    const postgres = { db: { select: selectSpy } };
    const service = new AuthContextService(postgres as never, redis as never);

    await redis.client.set(
      "v1:auth-context:user-1",
      JSON.stringify({
        id: "user-1",
        role: "user",
        plan: "free",
        status: "active",
        tokenVersion: 1,
        shadowLimited: false,
      }),
      "EX",
      60,
    );

    const context = await service.get("user-1");
    expect(context?.tokenVersion).toBe(1);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("invalidate() clears the cached entry", async () => {
    const redis = makeRedisFake();
    const postgres = makePostgresFake({
      id: "user-1",
      role: "user",
      status: "active",
      tokenVersion: 0,
    });
    const service = new AuthContextService(postgres as never, redis as never);

    await service.get("user-1"); // populates cache
    await service.invalidate("user-1");
    expect(redis.client.del).toHaveBeenCalledWith("v1:auth-context:user-1");
  });
});
