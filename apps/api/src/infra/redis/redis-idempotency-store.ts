import { Injectable } from "@nestjs/common";
import {
  IdempotencyStore,
  type StoredIdempotentResponse,
} from "../../common/interceptors/idempotency.interceptor";
import { RedisService } from "./redis.service";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// P3.2 shipped IdempotencyStore as an abstract class specifically so a real
// Redis-backed implementation could be swapped in later without touching
// the interceptor — this is that swap (PRD §17.9: "replay a stored response
// from Redis for 24h").
@Injectable()
export class RedisIdempotencyStore extends IdempotencyStore {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async get(key: string): Promise<StoredIdempotentResponse | undefined> {
    const raw = await this.redis.client.get(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as StoredIdempotentResponse;
  }

  async set(key: string, value: StoredIdempotentResponse): Promise<void> {
    // TTL enforced by Redis itself (EX), not by the stored expiresAt field —
    // that field only matters to InMemoryIdempotencyStore's own bookkeeping.
    await this.redis.client.set(key, JSON.stringify(value), "EX", IDEMPOTENCY_TTL_SECONDS);
  }
}
