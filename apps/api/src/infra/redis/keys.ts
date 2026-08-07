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
