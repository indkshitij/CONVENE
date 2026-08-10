import { describe, expect, it, vi } from "vitest";
import { ReplayService } from "./replay.service";
import type { RedisService } from "./infra/redis/redis.service";

function fakeRedis(entries: string[]) {
  return {
    client: {
      zrangebyscore: vi.fn(async (_key: string, min: string) => {
        const threshold = Number(min.replace("(", ""));
        return entries
          .map((entry) => JSON.parse(entry) as { sequence: number })
          .filter((entry) => entry.sequence > threshold)
          .map((entry) => JSON.stringify(entry));
      }),
    },
  } as unknown as RedisService;
}

describe("ReplayService", () => {
  it("returns only entries strictly after the given sequence, in order", async () => {
    const entries = [1, 2, 3, 4].map((sequence) =>
      JSON.stringify({ sequence, event: "e", payload: { n: sequence } }),
    );
    const redis = fakeRedis(entries);
    const replay = new ReplayService(redis);

    const result = await replay.getSince("rt:conv:1", 2);

    expect(result.map((entry) => entry.sequence)).toEqual([3, 4]);
  });

  it("reads from the channel's replay key", async () => {
    const redis = fakeRedis([]);
    const replay = new ReplayService(redis);

    await replay.getSince("rt:user:u1", 0);

    expect(redis.client.zrangebyscore).toHaveBeenCalledWith("rt:replay:rt:user:u1", "(0", "+inf");
  });
});
