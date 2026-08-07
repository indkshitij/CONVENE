import { describe, expect, it } from "vitest";
import type { Clock } from "../../../common/clock";
import { LoginLockoutService } from "./login-lockout.service";

class FakeRedisClient {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<"OK"> {
    this.store.set(key, value);
    return "OK";
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

function makeService(now: Date) {
  const clock: Clock = { now: () => now };
  const redis = { client: new FakeRedisClient() } as never;
  return new LoginLockoutService(redis, clock);
}

// BR-AUTH-07: "5 failed password attempts → exponential lockout (1, 2, 5,
// 15, 60 min). Lockout is per (account, IP) pair."
describe("LoginLockoutService", () => {
  it("is not locked before the 5th failure", async () => {
    const now = new Date("2026-08-03T00:00:00Z");
    const service = makeService(now);

    for (let i = 0; i < 4; i++) {
      const status = await service.recordFailure("user@example.com", "1.2.3.4");
      expect(status.locked).toBe(false);
    }
  });

  it("locks for 1 minute on the 5th failure", async () => {
    const now = new Date("2026-08-03T00:00:00Z");
    const service = makeService(now);

    for (let i = 0; i < 4; i++) await service.recordFailure("user@example.com", "1.2.3.4");
    const status = await service.recordFailure("user@example.com", "1.2.3.4");

    expect(status.locked).toBe(true);
    expect(status.retryAfterSeconds).toBe(60);
  });

  it("escalates the lockout duration on further failures (1,2,5,15,60 min)", async () => {
    const now = new Date("2026-08-03T00:00:00Z");
    const service = makeService(now);
    const expectedSeconds = [60, 120, 300, 900, 3600, 3600];

    for (let i = 0; i < 4; i++) await service.recordFailure("user@example.com", "1.2.3.4");

    for (const expected of expectedSeconds) {
      const status = await service.recordFailure("user@example.com", "1.2.3.4");
      expect(status.retryAfterSeconds).toBe(expected);
    }
  });

  it("is keyed on the (identifier, ip) pair — a different IP is not locked out", async () => {
    const now = new Date("2026-08-03T00:00:00Z");
    const service = makeService(now);

    for (let i = 0; i < 5; i++) await service.recordFailure("user@example.com", "1.2.3.4");

    const status = await service.check("user@example.com", "9.9.9.9");
    expect(status.locked).toBe(false);
  });

  it("reset() clears the lockout", async () => {
    const now = new Date("2026-08-03T00:00:00Z");
    const service = makeService(now);

    for (let i = 0; i < 5; i++) await service.recordFailure("user@example.com", "1.2.3.4");
    await service.reset("user@example.com", "1.2.3.4");

    const status = await service.check("user@example.com", "1.2.3.4");
    expect(status.locked).toBe(false);
  });
});
