import { describe, expect, it, vi } from "vitest";
import { ChannelFanoutService } from "./channel-fanout.service";
import type { RedisService } from "./infra/redis/redis.service";

function fakeSubscriber() {
  const handlers = new Map<string, (channel: string, message: string) => void>();
  return {
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: (channel: string, message: string) => void) => {
      handlers.set(event, handler);
    }),
    quit: vi.fn(async () => undefined),
    emitMessage(channel: string, message: string) {
      handlers.get("message")?.(channel, message);
    },
  };
}

function fakeRedis(subscriber: ReturnType<typeof fakeSubscriber>): RedisService {
  return { client: { duplicate: () => subscriber } } as unknown as RedisService;
}

describe("ChannelFanoutService", () => {
  it("subscribes to Redis only once even with multiple local subscribers on the same channel", async () => {
    const subscriber = fakeSubscriber();
    const fanout = new ChannelFanoutService(fakeRedis(subscriber));

    await fanout.subscribe("rt:conv:1", "sub-a", vi.fn());
    await fanout.subscribe("rt:conv:1", "sub-b", vi.fn());

    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith("rt:conv:1");
  });

  it("delivers an incoming message to every local subscriber of that channel", async () => {
    const subscriber = fakeSubscriber();
    const fanout = new ChannelFanoutService(fakeRedis(subscriber));
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    await fanout.subscribe("rt:conv:1", "sub-a", handlerA);
    await fanout.subscribe("rt:conv:1", "sub-b", handlerB);

    subscriber.emitMessage("rt:conv:1", "hello");

    expect(handlerA).toHaveBeenCalledWith("hello");
    expect(handlerB).toHaveBeenCalledWith("hello");
  });

  it("does not deliver messages from a channel the subscriber isn't on", async () => {
    const subscriber = fakeSubscriber();
    const fanout = new ChannelFanoutService(fakeRedis(subscriber));
    const handler = vi.fn();
    await fanout.subscribe("rt:conv:1", "sub-a", handler);

    subscriber.emitMessage("rt:conv:2", "unrelated");

    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribes from Redis only once the last local subscriber leaves", async () => {
    const subscriber = fakeSubscriber();
    const fanout = new ChannelFanoutService(fakeRedis(subscriber));
    await fanout.subscribe("rt:conv:1", "sub-a", vi.fn());
    await fanout.subscribe("rt:conv:1", "sub-b", vi.fn());

    await fanout.unsubscribe("rt:conv:1", "sub-a");
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();

    await fanout.unsubscribe("rt:conv:1", "sub-b");
    expect(subscriber.unsubscribe).toHaveBeenCalledWith("rt:conv:1");
  });

  it("unsubscribeAll removes a subscriber from every channel it was on", async () => {
    const subscriber = fakeSubscriber();
    const fanout = new ChannelFanoutService(fakeRedis(subscriber));
    await fanout.subscribe("rt:conv:1", "sub-a", vi.fn());
    await fanout.subscribe("rt:user:u1", "sub-a", vi.fn());

    await fanout.unsubscribeAll("sub-a");

    expect(subscriber.unsubscribe).toHaveBeenCalledWith("rt:conv:1");
    expect(subscriber.unsubscribe).toHaveBeenCalledWith("rt:user:u1");
  });
});
