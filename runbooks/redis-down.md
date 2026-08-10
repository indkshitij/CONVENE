# Runbook: Redis unavailable

**Alert**: Redis connection failures / `PING` timeout on the shared Redis
instance used for presence, availability caching, rate-limit sliding
windows, AI-gateway quota/cache/circuit-breaker state, and realtime pub/sub
fan-out (`apps/api/src/infra/redis/`, `apps/realtime`).

**Design commitment (§21.9)**: "Redis is treated as disposable: every key it
holds is either reconstructible from Postgres or acceptably lossy... presence
rebuilds from client heartbeats within 45s and availability from
`availability_sessions`."

## What's verified working today

- **Rate limiting fails closed to a conservative in-process limit.**
  `apps/api/src/common/rate-limit/rate-limit.guard.ts:83-95` —
  `check()` wraps the Redis sliding-window call in a `try/catch`; on any
  Redis error it falls through to `checkInProcess()`, which enforces
  `policy.limit / IN_PROCESS_FALLBACK_DIVISOR` (a stricter cap) using an
  in-memory log instead. This is real and directly matches the PRD row.

## Gaps found during this review (not previously catalogued)

- **No feed fallback to `availability_sessions` was found.** Grepped for
  "live status may be delayed" and any presence-fallback banner copy —
  zero hits. The `matching`/`discovery` read paths that show availability
  state don't appear to have a documented Redis-down code path; if Redis is
  unreachable, feed reads likely degrade by whatever `RedisService`'s own
  failure mode is (uncaught exception → 500), not the graceful "delayed
  live status" banner the PRD describes.
- **No 45-second presence-rebuild-from-heartbeats logic was located** in
  `apps/realtime`. Presence is read/written through Redis directly; there's
  no evidence of a reconstruction path if the Redis-held presence state is
  lost.
- **AI-gateway quota/cache/circuit-breaker state** (`apps/api/src/modules/ai-gateway/quota.service.ts`,
  `router.service.ts`) all read/write Redis directly with no documented
  fallback — a Redis outage would likely make every AI feature fail (which,
  incidentally, is _consistent_ with the LLM-provider-down row's own
  "unavailable, try later" UX, just via a different failure path than
  intended).

## Manual mitigation (until the above gaps are closed)

1. Confirm Redis is actually down, not just slow: check the managed
   provider's own status page and `apps/api`'s `/health` readiness probe
   (`apps/api/src/modules/health/health.controller.ts`).
2. Rate limiting will already have failed over automatically — no action
   needed there.
3. Expect availability/presence reads and all AI features to error or
   return stale data until Redis recovers. There is currently no automatic
   graceful-degradation UI for either — this is the highest-priority gap
   this runbook surfaces for a follow-up engineering pass.
4. On Redis recovery: no manual cache-warm step is required by design
   (§21.9's "disposable" commitment) — confirm presence/availability reads
   return to normal within a few request cycles.

## Exercising this drill for real

Requires a running `apps/api` + Redis (`docker-compose.yml` at repo root
brings up a local Redis) and killing the Redis container mid-traffic
(`docker compose stop redis`) while watching real requests. Not performed in
this pass — no Docker runtime available in this environment.
