// PRD §21.9 (Redis is disposable, every key reconstructible/lossy) and P3.3:
// "keys.ts is the single place any Redis key string is constructed", with a
// version prefix (v1:) so a deploy can invalidate a whole class of keys at
// once by bumping REDIS_KEY_VERSION. No other file in the codebase may
// build a Redis key by hand — always go through one of these functions.
const REDIS_KEY_VERSION = "v1";

function buildKey(...segments: string[]): string {
  return [REDIS_KEY_VERSION, ...segments].join(":");
}

export function idempotencyKey(routeIdentifier: string, idempotencyKeyHeader: string): string {
  return buildKey("idempotency", routeIdentifier, idempotencyKeyHeader);
}

export function rateLimitKey(scope: string, compositeKeyPart: string): string {
  return buildKey("rate-limit", scope, compositeKeyPart);
}

// BR-AUTH-07: "Lockout is per (account, IP) pair to avoid account-lockout
// DoS." Keyed on the submitted identifier (not a resolved user id) so the
// lockout mechanism itself never reveals whether the identifier matches a
// real account.
export function loginLockoutKey(identifier: string, ip: string): string {
  return buildKey("login-lockout", identifier, ip);
}

// P5.4/§17.4: "Auth context cached in Redis for 60s (id, role, plan,
// status, token version)."
export function authContextKey(userId: string): string {
  return buildKey("auth-context", userId);
}

// P5.5/§10.1.7 endpoint 10: ephemeral PKCE state, and the short-lived
// pending-link token used for the "explicit confirmation, never silent"
// OAuth-linking step (§13 F1). Both are disposable by design (§21.9) —
// losing either just means the user restarts that one OAuth attempt.
export function oauthStateKey(state: string): string {
  return buildKey("oauth-state", state);
}

export function oauthLinkKey(linkToken: string): string {
  return buildKey("oauth-link", linkToken);
}

// P6.1/§17.6: "Redis: profile card" row's sibling for taxonomies — the
// PRD's cache table doesn't give taxonomies their own row explicitly, but
// P6.1's own prompt does ("5min in-process LRU + Redis"); `kind` is one of
// skills/industries/cities/languages/interests, `query` is the typeahead
// string (empty string for the unfiltered listing).
export function taxonomyKey(kind: string, query: string): string {
  return buildKey("taxonomy", kind, query.toLowerCase());
}

// PRD §10.3.9 Redis keys table: `avail:{userId} → {state, expiresAt,
// sessionId, intentIds[]}, TTL = session remainder`. P10.1 writes this
// mirror; the sweeper/keyspace-notification consumer (P10.2) is what
// actually relies on the TTL for belt-and-braces expiry.
const AVAILABILITY_KEY_PREFIX = `${REDIS_KEY_VERSION}:avail:`;

export function availabilityKey(userId: string): string {
  return buildKey("avail", userId);
}

// The inverse of availabilityKey — the keyspace-notification listener
// (P10.2) receives only the raw expired key name and needs to recover the
// userId from it. Returns null for any key that isn't one of ours (the
// listener subscribes to *all* expired-key events on the DB, not just
// this key family).
export function parseAvailabilityKeyUserId(key: string): string | null {
  if (!key.startsWith(AVAILABILITY_KEY_PREFIX)) return null;
  const userId = key.slice(AVAILABILITY_KEY_PREFIX.length);
  return userId.length > 0 ? userId : null;
}

// PRD §10.3.9/§10.3.10 Redis keys table: `presence:{userId} →
// {socketCount, lastBeat, active}, TTL 45s` (BR-AVAIL-14). Owned/written by
// the realtime gateway (apps/realtime/src/infra/redis/keys.ts's own
// presenceKey, P11.1 — the two must produce identical strings, see that
// file's comment) — P10.2 only *reads* this key for BR-AVAIL-07 (auto-away)
// and BR-AVAIL-08 (disconnect ends session).
export function presenceKey(userId: string): string {
  return buildKey("presence", userId);
}

// BR-CONN-05 (P14.1): daily send quota, "Redis INCR + EXPIRE keyed to the
// user's local day" per the PRD's own words — a plain counter, not the
// sliding-window log used elsewhere, since the window is a calendar day
// boundary rather than a rolling one. `userLocalDate` is a caller-computed
// "YYYY-MM-DD" in the user's own timezone offset.
export function connectionRequestDailyQuotaKey(userId: string, userLocalDate: string): string {
  return buildKey("conn-req-daily", userId, userLocalDate);
}

// BR-CONN-06: identical-note detection bucket — the sender's recent
// normalised note hashes over a rolling 24h window (a Redis list, capped
// and TTL'd by the service, not by key expiry alone since each push must
// refresh visibility of older-but-still-in-window entries).
export function connectionRequestNoteHashKey(senderId: string): string {
  return buildKey("conn-req-note-hash", senderId);
}

// BR-CONN-06: the 60-minute soft-block a sender enters after tripping
// either the velocity cap or the identical-note detector.
export function connectionRequestSoftBlockKey(senderId: string): string {
  return buildKey("conn-req-soft-block", senderId);
}

// BR-NOTIF-02: "max 6 pushes/day, max 2/hour, excluding Critical
// priority." Two independent counters, same INCR+EXPIRE shape as
// connectionRequestDailyQuotaKey above. `userLocalHour` is a
// caller-computed "YYYY-MM-DDTHH" in the user's own timezone offset.
export function notificationPushDailyKey(userId: string, userLocalDate: string): string {
  return buildKey("notif-push-daily", userId, userLocalDate);
}

export function notificationPushHourlyKey(userId: string, userLocalHour: string): string {
  return buildKey("notif-push-hourly", userId, userLocalHour);
}

// §12.12: "Per user per calendar month, per feature." `yearMonth` is a
// caller-computed "YYYY-MM" in UTC (a monthly quota doesn't need
// timezone precision the way a daily one does — a user isn't harmed by
// their reset landing a few hours off their own local midnight).
export function aiMonthlyQuotaKey(userId: string, feature: string, yearMonth: string): string {
  return buildKey("ai-quota-monthly", userId, feature, yearMonth);
}

// §12.12: "Caching keyed on a hash of the grounding facts, not the
// prompt string." `groundingHash` is the caller's own hash of its
// structured grounding object — this key builder never sees prompt text.
export function aiCacheKey(feature: string, groundingHash: string): string {
  return buildKey("ai-cache", feature, groundingHash);
}

// §12.12: per-feature circuit breaker state (consecutive-failure count).
export function aiCircuitBreakerKey(feature: string): string {
  return buildKey("ai-circuit", feature);
}
