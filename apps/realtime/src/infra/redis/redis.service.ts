import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";

const PING_TIMEOUT_MS = 1000;

// Mirrors apps/api/src/infra/redis/redis.service.ts's lazy-connect/capped-
// backoff shape (PRD §21.9: Redis is disposable, boot must never block on
// it) — duplicated rather than imported because apps/* may not import
// other apps/* (module-boundary ESLint rule, P0.1).
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000),
    });
    this.client.on("error", () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch {
      // background retry via retryStrategy; boot must not fail on this.
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }

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
