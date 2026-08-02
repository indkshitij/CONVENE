import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";

const PING_TIMEOUT_MS = 1000;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    // lazyConnect + a capped retry backoff: PRD §21.9 treats Redis as
    // disposable ("every key it holds is either reconstructible from
    // Postgres or acceptably lossy"), so an unreachable Redis must never
    // block API boot or pile up unbounded reconnect attempts.
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000),
    });
    // ioredis emits "error" on every failed reconnect attempt while Redis
    // is down; leaving this unhandled would crash the process (unhandled
    // "error" event) and logging each attempt would flood output —
    // /health/ready is the surfacing mechanism for this outage instead.
    this.client.on("error", () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch {
      // Boot must not fail just because Redis is unreachable at startup
      // (PRD §21.9) — ioredis keeps retrying via retryStrategy in the
      // background and /health/ready reports the outage in the meantime.
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }

  /** Used by /health/ready. Never throws, never hangs past PING_TIMEOUT_MS. */
  async ping(): Promise<boolean> {
    try {
      const result = await Promise.race([
        this.client.ping(),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("Redis ping timeout")), PING_TIMEOUT_MS);
        }),
      ]);
      return result === "PONG";
    } catch {
      return false;
    }
  }
}
