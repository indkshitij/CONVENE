import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type Redis from "ioredis";
import { RedisService } from "./infra/redis/redis.service";

export type ChannelMessageHandler = (raw: string) => void;

// PRD §17.5: "the API writes to Postgres, then publishes to rt:conv:{id} /
// rt:user:{id}. Every gateway node subscribed to that channel delivers to
// its local sockets." One shared Redis SUBSCRIBE connection per gateway
// process (pub/sub connections can't run other commands — same reasoning
// as presence.service.ts's dedicated `duplicate()`), ref-counted so a
// channel is only actually SUBSCRIBEd/UNSUBSCRIBEd at the Redis level once
// regardless of how many local sockets care about it.
@Injectable()
export class ChannelFanoutService implements OnModuleDestroy {
  private readonly subscriber: Redis;
  // channel -> subscriberId -> handler
  private readonly handlersByChannel = new Map<string, Map<string, ChannelMessageHandler>>();
  // subscriberId -> the channels it's currently subscribed to (for unsubscribeAll on socket close)
  private readonly channelsBySubscriber = new Map<string, Set<string>>();

  constructor(redis: RedisService) {
    this.subscriber = redis.client.duplicate();
    this.subscriber.on("message", (channel: string, message: string) => {
      const handlers = this.handlersByChannel.get(channel);
      if (!handlers) return;
      for (const handler of handlers.values()) handler(message);
    });
  }

  async subscribe(
    channel: string,
    subscriberId: string,
    onMessage: ChannelMessageHandler,
  ): Promise<void> {
    let handlers = this.handlersByChannel.get(channel);
    if (!handlers) {
      handlers = new Map();
      this.handlersByChannel.set(channel, handlers);
      await this.subscriber.subscribe(channel);
    }
    handlers.set(subscriberId, onMessage);

    let channels = this.channelsBySubscriber.get(subscriberId);
    if (!channels) {
      channels = new Set();
      this.channelsBySubscriber.set(subscriberId, channels);
    }
    channels.add(channel);
  }

  async unsubscribe(channel: string, subscriberId: string): Promise<void> {
    const handlers = this.handlersByChannel.get(channel);
    if (handlers) {
      handlers.delete(subscriberId);
      if (handlers.size === 0) {
        this.handlersByChannel.delete(channel);
        await this.subscriber.unsubscribe(channel);
      }
    }
    this.channelsBySubscriber.get(subscriberId)?.delete(channel);
  }

  async unsubscribeAll(subscriberId: string): Promise<void> {
    const channels = this.channelsBySubscriber.get(subscriberId);
    if (!channels) return;
    for (const channel of [...channels]) {
      await this.unsubscribe(channel, subscriberId);
    }
    this.channelsBySubscriber.delete(subscriberId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.quit();
  }
}
