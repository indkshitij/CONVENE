# Runbook: Read replica lag > 10s

**Alert**: replication lag exceeding 10 seconds on any read replica.

**Design commitment (§21.9)**: "Reads route to primary with a reduced page
size."

**NFR-S-006**: "DB read scaling via replicas + PgBouncer, ≥3 replicas."

## What exists today

Confirmed during P29.3's traceability walk: **no read-replica routing
infrastructure exists anywhere in this codebase.** `packages/db/src/client.ts`'s
`createPooledClient()` connects to a single `DATABASE_URL` — there's no
primary/replica connection-pool split, no PgBouncer configuration, and no
query-router that could detect lag and redirect reads. Every query,
regardless of read/write, goes to the one configured database.

This means the entire degradation row — "detect lag on a replica, reroute
reads to primary" — describes infrastructure that hasn't been built yet.
NFR-S-006's "≥3 replicas" target is itself unmet in this repo (correctly:
this is an infrastructure/deployment-topology concern that belongs in a
separate infra repo per this codebase's own established pattern of not
including Terraform/K8s config here — but the _application-side_ routing
logic to actually use replicas, which _would_ live in this repo, also
doesn't exist).

## Manual mitigation

Not applicable today — there's only one database connection, so there's no
lag-routing decision to make. If read latency degrades under load, that's a
capacity/scaling incident against the single primary, not a replica-lag
scenario.

## Exercising this drill for real

Not exercisable until read-replica infrastructure and the application-side
routing logic both exist. When they do, this runbook needs: how lag is
measured (replication delay metric, source), the actual threshold/reroute
code path, and how "reduced page size" is implemented for the primary-routed
fallback path.
