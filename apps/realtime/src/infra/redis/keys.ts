// Mirrors apps/api/src/infra/redis/keys.ts's version-prefix convention
// (PRD §21.9/P3.3) — same `v1:` scheme, same "one place any key string is
// built" rule, but a separate file because apps/* may not import other
// apps/* (module-boundary rule). The two files must agree on the literal
// key formats below (presenceKey in particular — apps/api's copy reads
// the key P11.1's gateway writes; see that file's own comment on
// presenceKey for the P10.2 consumer side of this contract).
const REDIS_KEY_VERSION = "v1";

function buildKey(...segments: string[]): string {
  return [REDIS_KEY_VERSION, ...segments].join(":");
}

// PRD §17.5: "on connect it writes ws:conn:{userId}:{connId} -> {node,
// since} with a 60s TTL refreshed by heartbeat."
export function connectionKey(userId: string, connId: string): string {
  return buildKey("ws", "conn", userId, connId);
}

// PRD §10.3.9/§17.5: "presence:{userId}", 45s TTL, refreshed on heartbeat.
// Must match apps/api/src/infra/redis/keys.ts's presenceKey exactly — P10.2
// reads this same key to drive BR-AVAIL-07/08.
const PRESENCE_KEY_PREFIX = `${REDIS_KEY_VERSION}:presence:`;

export function presenceKey(userId: string): string {
  return buildKey("presence", userId);
}

// Inverse of presenceKey, for the keyspace-expiry listener (presence.lost,
// §17.5) to recover the userId from the raw expired key name.
export function parsePresenceKeyUserId(key: string): string | null {
  if (!key.startsWith(PRESENCE_KEY_PREFIX)) return null;
  const userId = key.slice(PRESENCE_KEY_PREFIX.length);
  return userId.length > 0 ? userId : null;
}

// Single-use enforcement for WS tickets (§17.4's "Single-use JWT"):
// keyed on the ticket's own jti, SETNX'd with the ticket's remaining TTL.
export function wsTicketUsedKey(jti: string): string {
  return buildKey("ws-ticket-used", jti);
}
