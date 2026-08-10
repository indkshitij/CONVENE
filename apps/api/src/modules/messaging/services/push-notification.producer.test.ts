import { execSync } from "node:child_process";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUSH_DELAY_MS, PushNotificationProducer } from "./push-notification.producer";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

// BR-MSG-06's scheduling/cancellation, verified against a real Redis
// (BullMQ needs actual blocking-command support a mock can't provide) —
// same precedent as embedding-refresh.producer.test.ts.
describe.skipIf(!dockerAvailable)("PushNotificationProducer (Testcontainers)", () => {
  let container: StartedRedisContainer;
  let client: Redis;
  let producer: PushNotificationProducer;

  beforeAll(async () => {
    container = await new RedisContainer("redis:7-alpine").start();
    client = new Redis(container.getConnectionUrl(), { maxRetriesPerRequest: null });
  }, 60_000);

  afterAll(async () => {
    client?.disconnect();
    await container?.stop();
  });

  beforeEach(() => {
    producer = new PushNotificationProducer({ client } as never);
  });

  function queueOf(p: PushNotificationProducer) {
    return (
      p as unknown as {
        queue: {
          getJob: (id: string) => Promise<{ id?: string; opts?: { delay?: number } } | undefined>;
          getJobCounts: () => Promise<Record<string, number>>;
        };
      }
    ).queue;
  }

  it("enqueues a delayed push job keyed by message+recipient, with the 8s delay", async () => {
    await producer.enqueuePush({
      messageId: "message-1",
      recipientUserId: "user-2",
      conversationId: "conversation-1",
    });
    const job = await queueOf(producer).getJob("message-1|user-2");
    expect(job?.id).toBe("message-1|user-2");
    expect(job?.opts?.delay).toBe(PUSH_DELAY_MS);
  });

  it("cancelPush removes a still-delayed job — this is the 'read within 8s produces no push' guarantee", async () => {
    await producer.enqueuePush({
      messageId: "message-2",
      recipientUserId: "user-2",
      conversationId: "conversation-1",
    });
    expect((await queueOf(producer).getJobCounts()).delayed).toBe(1);

    await producer.cancelPush("message-2", "user-2");

    const job = await queueOf(producer).getJob("message-2|user-2");
    expect(job).toBeUndefined();
    expect((await queueOf(producer).getJobCounts()).delayed).toBe(0);
  });

  it("cancelling a job for a different recipient leaves the original recipient's job untouched", async () => {
    await producer.enqueuePush({
      messageId: "message-3",
      recipientUserId: "user-2",
      conversationId: "conversation-1",
    });
    await producer.enqueuePush({
      messageId: "message-3",
      recipientUserId: "user-3",
      conversationId: "conversation-1",
    });

    await producer.cancelPush("message-3", "user-2");

    expect(await queueOf(producer).getJob("message-3|user-2")).toBeUndefined();
    expect((await queueOf(producer).getJob("message-3|user-3"))?.id).toBe("message-3|user-3");
  });

  it("cancelling a nonexistent job is a safe no-op", async () => {
    await expect(producer.cancelPush("no-such-message", "user-2")).resolves.toBeUndefined();
  });
});
