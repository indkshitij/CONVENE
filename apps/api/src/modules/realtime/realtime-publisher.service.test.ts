import { describe, expect, it, vi } from "vitest";
import type { RedisService } from "../../infra/redis/redis.service";
import { RealtimePublisherService } from "./realtime-publisher.service";

function fakeRedis() {
  let seq = 0;
  const multiCalls: Array<{ method: string; args: unknown[] }> = [];
  const multi = {
    zadd: vi.fn((...args: unknown[]) => {
      multiCalls.push({ method: "zadd", args });
      return multi;
    }),
    zremrangebyrank: vi.fn((...args: unknown[]) => {
      multiCalls.push({ method: "zremrangebyrank", args });
      return multi;
    }),
    expire: vi.fn((...args: unknown[]) => {
      multiCalls.push({ method: "expire", args });
      return multi;
    }),
    publish: vi.fn((...args: unknown[]) => {
      multiCalls.push({ method: "publish", args });
      return multi;
    }),
    exec: vi.fn(async () => []),
  };
  const client = {
    incr: vi.fn(async () => ++seq),
    multi: vi.fn(() => multi),
  };
  return { client, multi, multiCalls } as unknown as RedisService & {
    multi: typeof multi;
    multiCalls: typeof multiCalls;
  };
}

describe("RealtimePublisherService", () => {
  it("assigns a monotonically increasing sequence per channel", async () => {
    const redis = fakeRedis();
    const publisher = new RealtimePublisherService(redis);

    const a = await publisher.publish("rt:conv:1", "message.new", { text: "hi" });
    const b = await publisher.publish("rt:conv:1", "message.new", { text: "there" });

    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it("writes to the replay ZSET, caps it, sets a TTL, and publishes — in that order", async () => {
    const redis = fakeRedis();
    const publisher = new RealtimePublisherService(redis);

    await publisher.publish("rt:user:u1", "notification", { kind: "quota_changed" });

    const methods = redis.multiCalls.map((call) => call.method);
    expect(methods).toEqual(["zadd", "zremrangebyrank", "expire", "publish"]);
    expect(redis.multi.zadd).toHaveBeenCalledWith("rt:replay:rt:user:u1", 1, expect.any(String));
    expect(redis.multi.publish).toHaveBeenCalledWith("rt:user:u1", expect.any(String));
  });

  it("publishes a JSON envelope containing sequence, event, and payload", async () => {
    const redis = fakeRedis();
    const publisher = new RealtimePublisherService(redis);

    await publisher.publish("rt:presence:abcde", "availability.started", {
      userId: "u1",
      state: "available_now",
    });

    const published = JSON.parse(
      (redis.multi.publish as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string,
    );
    expect(published).toEqual({
      sequence: 1,
      event: "availability.started",
      payload: { userId: "u1", state: "available_now" },
    });
  });
});
