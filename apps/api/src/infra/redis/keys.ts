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
