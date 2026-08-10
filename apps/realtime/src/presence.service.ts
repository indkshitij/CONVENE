import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type Redis from "ioredis";
import { connectionKey, parsePresenceKeyUserId, presenceKey } from "./infra/redis/keys";
import { RedisService } from "./infra/redis/redis.service";

const REDIS_DB_INDEX = 0;
const EXPIRED_KEYEVENT_PATTERN = `__keyevent@${REDIS_DB_INDEX}__:expired`;

// PRD §17.5: "on connect it writes ws:conn:{userId}:{connId} -> {node,
// since} with a 60s TTL refreshed by heartbeat." §10.3.9/§17.5:
// "presence:{userId}" carries a 45s TTL, refreshed the same way.
export const CONNECTION_TTL_SECONDS = 60;
export const PRESENCE_TTL_SECONDS = 45;

// PRD §17.5: "Key expiry (Redis keyspace notification) triggers
// presence.lost." Consumed (eventually) by BR-AVAIL-08's 5-minute
// grace-then-end-session logic — out of this phase's scope, but the event
// is emitted now the same "emit now, consume later" way P7.4/P8.1's domain
// events were.
export const PRESENCE_LOST_EVENT = "presence.lost";

export interface PresenceLostPayload {
  userId: string;
}

// PRD §17.5's gateway-owned half of presence. Same keyspace-notification
// pattern as availability-keyspace-listener.service.ts (P10.2) — best-
// effort CONFIG SET, since some managed Redis providers disallow it; the
// gateway's own 45s TTL is what actually bounds staleness regardless of
// whether the notification fires.
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private subscriber: Redis | undefined;

  constructor(
    private readonly redis: RedisService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.client.config("SET", "notify-keyspace-events", "Ex");
    } catch {
      this.logger.warn(
        "Could not set notify-keyspace-events — presence.lost will not fire on expiry; presence:{userId}'s own TTL still bounds staleness.",
      );
    }

    this.subscriber = this.redis.client.duplicate();
    await this.subscriber.psubscribe(EXPIRED_KEYEVENT_PATTERN);
    this.subscriber.on("pmessage", (_pattern: string, _channel: string, expiredKey: string) => {
      const userId = parsePresenceKeyUserId(expiredKey);
      if (!userId) return;
      this.events?.emit(PRESENCE_LOST_EVENT, { userId } satisfies PresenceLostPayload);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }

  async registerConnection(userId: string, connId: string, node: string): Promise<void> {
    await this.redis.client.set(
      connectionKey(userId, connId),
      JSON.stringify({ node, since: new Date().toISOString() }),
      "EX",
      CONNECTION_TTL_SECONDS,
    );
    await this.touchPresence(userId);
  }

  async heartbeat(userId: string, connId: string): Promise<void> {
    await this.redis.client.expire(connectionKey(userId, connId), CONNECTION_TTL_SECONDS);
    await this.touchPresence(userId);
  }

  async removeConnection(userId: string, connId: string): Promise<void> {
    await this.redis.client.del(connectionKey(userId, connId));
  }

  private async touchPresence(userId: string): Promise<void> {
    await this.redis.client.set(presenceKey(userId), "1", "EX", PRESENCE_TTL_SECONDS);
  }
}
