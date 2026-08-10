import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type Redis from "ioredis";
import { parseAvailabilityKeyUserId } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import { AvailabilityExpiryService } from "./availability-expiry.service";

const REDIS_DB_INDEX = 0; // matches ioredis's default unless REDIS_URL specifies otherwise.
const EXPIRED_KEYEVENT_PATTERN = `__keyevent@${REDIS_DB_INDEX}__:expired`;

// PRD §10.3.10's "belt" — fully independent of the sweeper worker: a
// Redis TTL on avail:{userId} (set at session-creation time,
// availability.service.ts) firing a native keyspace-expiry notification.
// Requires `notify-keyspace-events` to include key-expired events ("Ex")
// on the Redis server; best-effort configured here since some managed
// Redis providers disable runtime CONFIG SET (the sweeper still works
// regardless — that's the whole point of "either alone must be
// sufficient").
@Injectable()
export class AvailabilityKeyspaceListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvailabilityKeyspaceListenerService.name);
  private subscriber: Redis | undefined;

  constructor(
    private readonly redisService: RedisService,
    private readonly expiryService: AvailabilityExpiryService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redisService.client.config("SET", "notify-keyspace-events", "Ex");
    } catch {
      this.logger.warn(
        "Could not set notify-keyspace-events (managed Redis may disallow CONFIG SET) — the belt mechanism is inactive; the braces sweeper still expires sessions independently.",
      );
    }

    // Pub/sub connections can't run other commands — a dedicated
    // duplicate, not the shared request-path client.
    this.subscriber = this.redisService.client.duplicate();
    await this.subscriber.psubscribe(EXPIRED_KEYEVENT_PATTERN);
    this.subscriber.on("pmessage", (_pattern: string, _channel: string, expiredKey: string) => {
      const userId = parseAvailabilityKeyUserId(expiredKey);
      if (!userId) return;
      this.expiryService.expireByUserId(userId).catch((error: unknown) => {
        this.logger.error(
          `Failed to expire session for user ${userId} via keyspace notification`,
          error,
        );
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }
}
