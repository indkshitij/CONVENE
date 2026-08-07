import { Injectable, Optional } from "@nestjs/common";
import { type Clock, systemClock } from "../clock";
import { RedisService } from "../../infra/redis/redis.service";

// PRD §17.6's cache-layer table: "In-process LRU ... 5 min ... config
// version bump" for taxonomies specifically. A bounded Map used as an LRU
// (re-inserting on hit moves an entry to the most-recently-used end;
// eviction removes from the least-recently-used end) plus Redis behind it
// so a cache miss on one API instance can still be served from another
// instance's write instead of hitting Postgres again.
const DEFAULT_MAX_LOCAL_ENTRIES = 500;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class CacheService {
  private readonly local = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly redis: RedisService,
    @Optional() private readonly clock: Clock = systemClock,
    @Optional() private readonly maxLocalEntries: number = DEFAULT_MAX_LOCAL_ENTRIES,
  ) {}

  // Serves from the in-process LRU first (fastest, no network at all),
  // then Redis (shared across instances), only calling `factory` — the
  // actual DB read — on a full miss at both layers.
  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const now = this.clock.now().getTime();

    const local = this.local.get(key);
    if (local && local.expiresAt > now) {
      this.touch(key, local);
      return local.value as T;
    }

    const cached = await this.redis.client.get(key);
    if (cached !== null) {
      const value = JSON.parse(cached) as T;
      this.setLocal(key, value, now + ttlSeconds * 1000);
      return value;
    }

    const value = await factory();
    await this.redis.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    this.setLocal(key, value, now + ttlSeconds * 1000);
    return value;
  }

  async invalidate(key: string): Promise<void> {
    this.local.delete(key);
    await this.redis.client.del(key);
  }

  private touch(key: string, entry: CacheEntry<unknown>): void {
    // Map preserves insertion order; delete + re-set moves this key to
    // the most-recently-used end for eviction purposes.
    this.local.delete(key);
    this.local.set(key, entry);
  }

  private setLocal<T>(key: string, value: T, expiresAt: number): void {
    this.local.set(key, { value, expiresAt });
    if (this.local.size > this.maxLocalEntries) {
      const oldestKey = this.local.keys().next().value;
      if (oldestKey !== undefined) this.local.delete(oldestKey);
    }
  }
}
