// PRD §17.5's channel table, verbatim channel-name families. These are
// pub/sub channel names, not versioned cache keys — no `v1:` prefix (a
// deploy invalidating cached data has no bearing on a live broadcast
// channel's name). Must match apps/realtime/src/infra/redis/channels.ts
// exactly (see that file's own comment — apps/* may not import apps/*).
export function userChannel(userId: string): string {
  return `rt:user:${userId}`;
}

export function conversationChannel(conversationId: string): string {
  return `rt:conv:${conversationId}`;
}

export function presenceGeoChannel(geohash5: string): string {
  return `rt:presence:${geohash5}`;
}

export const ADMIN_REPORTS_CHANNEL = "rt:admin:reports";

// PRD §17.5: "on reconnect the client sends {conversationId,
// after_sequence} per open conversation and receives a gap-free replay."
// No Messaging module exists yet to source that replay from Postgres
// (that's a later phase), so P11.2 builds a bounded Redis ZSET buffer per
// channel instead — every publish() call (realtime-publisher.service.ts)
// assigns a monotonic sequence and stores the entry here, capped so an
// outage far longer than the buffer can hold degrades honestly (the
// replay simply starts from the oldest entry still buffered) rather than
// silently claiming gap-free-ness it can't back up. Sized well past the
// stated 5-minute-outage acceptance criterion (§10.7's own message-volume
// rate limits: 60/min/conversation × 5 min = 300 — 500 leaves headroom).
export const REPLAY_BUFFER_SIZE = 500;
export const REPLAY_TTL_SECONDS = 15 * 60;

export function channelReplayKey(channel: string): string {
  return `rt:replay:${channel}`;
}

export function channelSequenceKey(channel: string): string {
  return `rt:seq:${channel}`;
}
