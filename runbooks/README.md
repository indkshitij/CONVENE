# Runbooks

PRD §21.10: "runbooks maintained in the repo beside the code, linked from
every alert, and exercised twice a year in a game-day including a full
database restore and a region failover." §21.9 names seven dependency
failure modes with documented degraded behaviour; this directory has one
runbook per row, plus the database restore drill §21.9/§22.12 requires.

**P29.4 disposition, stated plainly**: this pass wrote every runbook below
and verified each dependency's documented degraded behaviour against the
_real code_ (citing file:line, not PRD prose) — the same evidence-based
method P29.2/P29.3 used. It did **not** _actually kill_ Redis/the LLM
provider/object storage/push/a replica in a running environment and observe
the failure live, and it did **not** perform a real database restore drill.
Both require Docker (`docker-compose.yml` exists in this repo, but the
`docker` binary itself isn't available in this sandbox — confirmed, not
assumed) and a live Postgres/Redis/S3-compatible stack this environment
doesn't have. Same category of gap as P29.1's load tests and P29.2's ZAP
baseline. What's below is real, evidence-grounded, and ready to be exercised
literally the next time someone runs this against a real environment — but
"exercised" and "restore verified inside RTO" are not honestly claimable
from this sandbox.

## Degradation matrix (§21.9)

| Dependency down                                 | Documented behaviour                                                                                                                             | Verified in code?                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [Redis](./redis-down.md)                        | Presence/live availability unavailable; feed falls back to `availability_sessions`; rate limiting fails closed to conservative in-process limits | Rate-limit fallback: YES (real, tested). Feed/presence fallback: **NOT FOUND** — gap       |
| [LLM provider](./llm-provider-down.md)          | AI features show "unavailable, try later"; manual paths stay functional; moderation falls back to classifier + stricter threshold                | YES (real, tested)                                                                         |
| [Object storage](./object-storage-down.md)      | Existing media served from CDN cache; uploads disabled with explicit copy                                                                        | PARTIAL — no real object storage exists yet (local filesystem dev stub)                    |
| [Payment provider](./payment-provider-down.md)  | Existing entitlements honoured locally; new checkouts disabled                                                                                   | Vacuously true — no live payment provider exists to fail                                   |
| [Push provider](./push-provider-down.md)        | In-app notifications continue; digest email for high-priority categories                                                                         | YES (real, tested)                                                                         |
| [Search](./search-down.md)                      | Falls back to filter-only browse                                                                                                                 | **NOT FOUND** — gap, and the premise may not even apply to this architecture (see runbook) |
| [Read replica lag >10s](./replica-lag.md)       | Reads route to primary with reduced page size                                                                                                    | **NOT FOUND** — no read-replica routing exists at all yet                                  |
| [Database restore](./database-restore-drill.md) | Full restore verified inside 60-minute RTO, quarterly                                                                                            | Not executed this pass — needs a real Postgres instance with WAL archiving                 |

Three of the seven degradation rows described in the PRD have **no
corresponding code** — this is real signal a game day is supposed to
surface, not a documentation formality. Flagged per-runbook, not silently
assumed to exist because the PRD describes it.

## Other alerts

- [KPI guardrail breach](./guardrail-breach.md) — §21.1's five guardrails.
  The threshold/breach-check logic is real and tested
  (`packages/analytics/src/kpi/guardrails.ts`); the pipeline that computes
  live metrics and actually fires this alert isn't built yet.

§21.4's remaining named "key signals" (per-endpoint RED metrics, WS
connection counts, queue depth/age, DB slow queries, cache hit ratios, LLM
latency/spend) are Grafana dashboard line-items, not separate incident
_types_ each needing their own runbook — they're triaged via the Service
Health / Real-Time / Matching / Messaging dashboards named in §21.4, with
the dependency-specific runbooks above as the next step once a dashboard
points at a specific failing dependency.
