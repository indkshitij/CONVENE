import { EventEmitter2 } from "@nestjs/event-emitter";
import { describe, expect, it, vi } from "vitest";
import { PRESENCE_LOST_EVENT, PresenceService } from "./presence.service";
import type { RedisService } from "./infra/redis/redis.service";

function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    config: vi.fn(async () => "OK"),
    duplicate: vi.fn(() => ({
      psubscribe: vi.fn(async () => undefined),
      on: vi.fn(),
      quit: vi.fn(async () => undefined),
    })),
  };
  return { client, store } as unknown as RedisService & { store: Map<string, string> };
}

describe("PresenceService", () => {
  it("registerConnection writes both the connection key and presence key", async () => {
    const redis = fakeRedis();
    const service = new PresenceService(redis);
    await service.registerConnection("user-1", "conn-1", "node-a");

    expect(redis.client.set).toHaveBeenCalledWith(
      "v1:ws:conn:user-1:conn-1",
      expect.stringContaining("node-a"),
      "EX",
      60,
    );
    expect(redis.client.set).toHaveBeenCalledWith("v1:presence:user-1", "1", "EX", 45);
  });

  it("heartbeat refreshes the connection TTL and re-touches presence", async () => {
    const redis = fakeRedis();
    const service = new PresenceService(redis);
    await service.heartbeat("user-1", "conn-1");

    expect(redis.client.expire).toHaveBeenCalledWith("v1:ws:conn:user-1:conn-1", 60);
    expect(redis.client.set).toHaveBeenCalledWith("v1:presence:user-1", "1", "EX", 45);
  });

  it("removeConnection deletes only the connection key, not presence", async () => {
    const redis = fakeRedis();
    const service = new PresenceService(redis);
    await service.removeConnection("user-1", "conn-1");

    expect(redis.client.del).toHaveBeenCalledWith("v1:ws:conn:user-1:conn-1");
  });

  it("emits presence.lost when the presence key's expiry notification arrives", async () => {
    const redis = fakeRedis();
    const events = new EventEmitter2();
    const service = new PresenceService(redis, events);
    const handler = vi.fn();
    events.on(PRESENCE_LOST_EVENT, handler);

    await service.onModuleInit();
    const onCall = (redis.client.duplicate as ReturnType<typeof vi.fn>).mock.results[0]!.value.on;
    const pmessageHandler = onCall.mock.calls.find((call: unknown[]) => call[0] === "pmessage")[1];
    pmessageHandler("__keyevent@0__:expired", "__keyevent@0__:expired", "v1:presence:user-1");

    expect(handler).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("ignores expiry notifications for keys that aren't presence keys", async () => {
    const redis = fakeRedis();
    const events = new EventEmitter2();
    const service = new PresenceService(redis, events);
    const handler = vi.fn();
    events.on(PRESENCE_LOST_EVENT, handler);

    await service.onModuleInit();
    const onCall = (redis.client.duplicate as ReturnType<typeof vi.fn>).mock.results[0]!.value.on;
    const pmessageHandler = onCall.mock.calls.find((call: unknown[]) => call[0] === "pmessage")[1];
    pmessageHandler("__keyevent@0__:expired", "__keyevent@0__:expired", "v1:ws:conn:user-1:conn-1");

    expect(handler).not.toHaveBeenCalled();
  });
});
