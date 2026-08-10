import { Injectable } from "@nestjs/common";
import {
  channelReplayKey,
  channelSequenceKey,
  REPLAY_BUFFER_SIZE,
  REPLAY_TTL_SECONDS,
} from "../../infra/redis/channels";
import { RedisService } from "../../infra/redis/redis.service";

export interface ReplayEntry {
  sequence: number;
  event: string;
  payload: unknown;
}

// PRD §17.5: "the API writes to Postgres, then publishes to rt:conv:{id} /
// rt:user:{id}." Every module that needs to fan out a real-time update
// calls this *after* its own DB transaction has committed — never before,
// since a subscriber acting on an event whose write hasn't landed yet
// could read stale state.
//
// Beyond the plain PUBLISH, every call also appends to a capped, TTL'd
// Redis ZSET (see infra/redis/channels.ts's own comment on why: no
// Messaging module exists yet to source a real gap-free replay from
// Postgres) so apps/realtime's reconnection handling can serve recently-
// missed events by sequence number.
@Injectable()
export class RealtimePublisherService {
  constructor(private readonly redis: RedisService) {}

  async publish(channel: string, event: string, payload: unknown): Promise<number> {
    const sequence = await this.redis.client.incr(channelSequenceKey(channel));
    const entry: ReplayEntry = { sequence, event, payload };
    const serialized = JSON.stringify(entry);
    const replayKey = channelReplayKey(channel);

    await this.redis.client
      .multi()
      .zadd(replayKey, sequence, serialized)
      .zremrangebyrank(replayKey, 0, -(REPLAY_BUFFER_SIZE + 1))
      .expire(replayKey, REPLAY_TTL_SECONDS)
      .publish(channel, serialized)
      .exec();

    return sequence;
  }
}
