import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";

// A separate connection from RedisService's own client (infra/redis/
// redis.service.ts) — BullMQ requires `maxRetriesPerRequest: null` since
// its Workers issue blocking commands that a capped-retry client would
// abort mid-wait, which is incompatible with RedisService's request-path
// tuning (maxRetriesPerRequest: 1).
@Injectable()
export class BullmqConnectionService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    this.client.on("error", () => undefined);
  }

  // Same reasoning as RedisService.onModuleInit: an explicit, caught
  // connect() here (rather than leaving it to whatever BullMQ command
  // happens to fire first) means the connection attempt has a
  // deterministic owner and failure mode — boot must not fail just
  // because Redis is unreachable at startup (PRD §21.9), and a lazy
  // connect racing against a fast module teardown (e.g. in tests) is what
  // produced an unhandled "Connection is closed" rejection before this
  // fix.
  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch {
      // Retried in the background by ioredis's own retry strategy;
      // /health/ready is the surfacing mechanism for this outage.
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
