# Runbook: Search unavailable

**Alert**: elevated error rate on `GET /search/users`
(`apps/api/src/modules/search/search.service.ts`).

**Design commitment (§21.9)**: "Falls back to filter-only browse."

## Why this row's premise doesn't match the current architecture

The PRD's tech-stack section (§19.1) names the _production_ search choice as
"Postgres FTS + pgvector (RRF)... documented migration path to OpenSearch."
Reading `search.service.ts` directly confirms today's actual implementation
is plainer still: `ILIKE` queries directly against the `profiles`/`users`
tables in the same Postgres instance every other feature uses (own comment:
"Intentionally simple (ILIKE, not the PRD's full FTS/vector orchestration)").

**There is no separate "search service" to go down independently of
Postgres today.** The PRD's degradation row implicitly assumes a future
architecture (OpenSearch, or even the FTS+pgvector version) where search is
a distinct system with its own failure mode, decoupled from the primary
database. In the current implementation, "search is down but the rest of
the app is up" isn't a real, isolated failure — if Postgres is unreachable,
search fails exactly the same way profile reads, discovery, and everything
else does, because they're the same dependency.

## What's verified working today

Nothing search-specific — there's no distinct fallback code, because
there's no distinct failure mode to fall back from. The "filter-only browse"
UX the PRD describes already effectively exists as `/discover`'s own
structured-filter feed (separate from `/search`), so a user who can't use
free-text search always has that path available regardless — but this is
incidental to the discover feature's own design, not a built search-outage
fallback.

## Manual mitigation

If `/search/users` specifically is erroring while the rest of the app is
healthy, that's a bug in the search endpoint itself (a query timeout, a bad
`ILIKE` pattern, etc.), not a "dependency down" scenario — treat as a normal
incident against that one endpoint, not this degradation runbook's scenario.

## Exercising this drill for real

Not a meaningful drill to run against the current architecture — there's no
way to kill "search" in isolation without killing Postgres, which is a
different, much larger incident (every feature depends on the same
database) outside this runbook's scope. This row should be revisited (or
removed) if/when search migrates to a genuinely separate system.
