import { Injectable } from "@nestjs/common";
import { channelReplayKey } from "./infra/redis/channels";
import { RedisService } from "./infra/redis/redis.service";

export interface ReplayEntry {
  sequence: number;
  event: string;
  payload: unknown;
}

// Reads the bounded ZSET buffer apps/api's RealtimePublisherService writes
// to on every publish() call (see infra/redis/channels.ts's own comment on
// why this exists instead of a real Postgres-backed replay). Ordered by
// sequence, exclusive of afterSequence itself.
@Injectable()
export class ReplayService {
  constructor(private readonly redis: RedisService) {}

  async getSince(channel: string, afterSequence: number): Promise<ReplayEntry[]> {
    const raw = await this.redis.client.zrangebyscore(
      channelReplayKey(channel),
      `(${afterSequence}`,
      "+inf",
    );
    return raw.map((entry) => JSON.parse(entry) as ReplayEntry);
  }
}
