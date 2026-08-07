import { execSync } from "node:child_process";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingRefreshProducer } from "./embedding-refresh.producer";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

// BR-PROF-09's debounce behaviour, verified against a real Redis (BullMQ
// needs actual blocking-command support a mock can't provide) — same
// precedent as sliding-window.integration.test.ts.
describe.skipIf(!dockerAvailable)("EmbeddingRefreshProducer (Testcontainers)", () => {
  let container: StartedRedisContainer;
  let client: Redis;
  let producer: EmbeddingRefreshProducer;

  beforeAll(async () => {
    container = await new RedisContainer("redis:7-alpine").start();
    client = new Redis(container.getConnectionUrl(), { maxRetriesPerRequest: null });
  }, 60_000);

  afterAll(async () => {
    client?.disconnect();
    await container?.stop();
  });

  beforeEach(() => {
    producer = new EmbeddingRefreshProducer({ client } as never);
  });

  it("enqueues a delayed job keyed by userId", async () => {
    await producer.enqueueRefresh("user-1");
    const job = await (
      producer as unknown as {
        queue: { getJob: (id: string) => Promise<{ id?: string } | undefined> };
      }
    ).queue.getJob("user-1");
    expect(job?.id).toBe("user-1");
  });

  it("resets the delay (debounces) on a second call before the first fires, without creating a second job", async () => {
    await producer.enqueueRefresh("user-2");
    const queue = (
      producer as unknown as { queue: { getJobCounts: () => Promise<Record<string, number>> } }
    ).queue;
    const firstCounts = await queue.getJobCounts();
    expect(firstCounts.delayed).toBe(1);

    await producer.enqueueRefresh("user-2");
    const secondCounts = await queue.getJobCounts();
    expect(secondCounts.delayed).toBe(1); // still exactly one pending job, not two
  });
});
