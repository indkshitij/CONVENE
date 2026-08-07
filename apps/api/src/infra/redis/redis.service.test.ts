import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env.schema";

const mockOn = vi.fn();
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();
let mockPing: () => Promise<string>;

// vi.mock calls are hoisted above all imports by vitest's transform, so
// this takes effect before the static import of RedisService below (which
// transitively imports "ioredis") even though it's written first here for
// readability.
vi.mock("ioredis", () => {
  class FakeRedis {
    on = mockOn;
    connect = mockConnect;
    disconnect = mockDisconnect;
    ping(): Promise<string> {
      return mockPing();
    }
  }
  return { default: FakeRedis };
});

import { RedisService } from "./redis.service";

const fakeEnv: Env = {
  NODE_ENV: "test",
  PORT: 8080,
  DATABASE_URL: "postgres://convene:convene@localhost:5432/convene",
  REDIS_URL: "redis://localhost:6379",
  LOG_LEVEL: "info",
  JWKS_KEYS_PATH: ".keys/jwks-keys.json",
};

// P3.3 acceptance: "stop Redis in a test and assert /health/ready returns
// 503 ... " — RedisService.ping() is the primitive that check relies on;
// it must never throw and must never hang past its own timeout, regardless
// of how the underlying client fails.
describe("RedisService", () => {
  it("ping() resolves true when the client responds PONG", async () => {
    mockPing = () => Promise.resolve("PONG");
    const service = new RedisService(fakeEnv);
    await expect(service.ping()).resolves.toBe(true);
  });

  it("ping() resolves false (never throws) when the client rejects", async () => {
    mockPing = () => Promise.reject(new Error("connection closed"));
    const service = new RedisService(fakeEnv);
    await expect(service.ping()).resolves.toBe(false);
  });

  it("ping() resolves false when the client hangs past the timeout", async () => {
    mockPing = () => new Promise<string>(() => undefined);
    const service = new RedisService(fakeEnv);
    await expect(service.ping()).resolves.toBe(false);
  }, 3000);

  it("onModuleInit() does not throw when connect() rejects (boot must not fail on Redis being down)", async () => {
    mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const service = new RedisService(fakeEnv);
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
