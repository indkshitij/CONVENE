import { execSync } from "node:child_process";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evalSlidingWindow } from "./sliding-window";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

// P3.4 acceptance: the Lua script's actual windowing behaviour, verified
// against a real Redis rather than a mock (unlike rate-limit.guard.test.ts,
// which mocks this module to unit-test the guard's own logic). Requires a
// real Docker daemon (Testcontainers) — skips gracefully where one isn't
// available, matching packages/db's integration test convention.
describe.skipIf(!dockerAvailable)("evalSlidingWindow (real Redis, Testcontainers)", () => {
  let container: StartedRedisContainer;
  let client: Redis;

  beforeAll(async () => {
    container = await new RedisContainer("redis:7-alpine").start();
    client = new Redis(container.getConnectionUrl());
  }, 60_000);

  afterAll(async () => {
    client?.disconnect();
    await container?.stop();
  });

  it("allows requests up to the limit and blocks the next one", async () => {
    const key = "test:sliding-window:basic";
    const windowMs = 60_000;
    const limit = 3;

    for (let i = 0; i < limit; i++) {
      const result = await evalSlidingWindow(
        client,
        key,
        Date.now(),
        windowMs,
        limit,
        `member-${i}`,
      );
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(i + 1);
    }

    const blocked = await evalSlidingWindow(
      client,
      key,
      Date.now(),
      windowMs,
      limit,
      "member-over",
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(limit);
  });

  it("allows requests again once old entries fall outside the window", async () => {
    const key = "test:sliding-window:expiry";
    const windowMs = 200;
    const limit = 1;
    const now = Date.now();

    const first = await evalSlidingWindow(client, key, now, windowMs, limit, "member-a");
    expect(first.allowed).toBe(true);

    const stillWithinWindow = await evalSlidingWindow(
      client,
      key,
      now + 50,
      windowMs,
      limit,
      "member-b",
    );
    expect(stillWithinWindow.allowed).toBe(false);

    const afterWindow = await evalSlidingWindow(
      client,
      key,
      now + windowMs + 50,
      windowMs,
      limit,
      "member-c",
    );
    expect(afterWindow.allowed).toBe(true);
  });

  it("is atomic under concurrent requests — never admits more than the limit", async () => {
    const key = "test:sliding-window:concurrency";
    const windowMs = 60_000;
    const limit = 5;
    const now = Date.now();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        evalSlidingWindow(client, key, now, windowMs, limit, `concurrent-${i}`),
      ),
    );

    const allowedCount = results.filter((result) => result.allowed).length;
    expect(allowedCount).toBe(limit);
  });

  it("keeps independent keys independent", async () => {
    const windowMs = 60_000;
    const limit = 1;
    const now = Date.now();

    const a = await evalSlidingWindow(
      client,
      "test:sliding-window:key-a",
      now,
      windowMs,
      limit,
      "member-a",
    );
    const b = await evalSlidingWindow(
      client,
      "test:sliding-window:key-b",
      now,
      windowMs,
      limit,
      "member-b",
    );

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});
