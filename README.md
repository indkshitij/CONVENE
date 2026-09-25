# Convene  

Convene is a real-time, intent-based professional networking platform: users
declare _why_ they want to connect (mentorship, hiring, cofounding, a coffee
chat) and _when_ they're actually free right now, and the matching engine
ranks other available people against that intent instead of a static,
LinkedIn-style profile browse. The core product loop is "go available → get
matched → message → build a real connection," not a feed to scroll.

## Reference documents

These live under `docs/` in this working directory but **are not committed
to git** (`.gitignore` excludes the whole `docs/` folder) — a fresh
`git clone` of this repository will not have them. If you're reading this
after cloning fresh and `docs/` is empty, get the source documents from
whoever handed you this repo before continuing; large parts of this README
(and the code) assume you can cross-reference them.

| Document                      | Purpose                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/Convene-PRD-v1.0.md`    | The PRD — product, architecture, and business rules. Section refs like `§10.3` or `BR-AVAIL-08` always point here. This is the single source of truth for _what_ the product does and _why_. |
| `docs/DEVELOPMENT_PLAN.md`    | Phase-by-phase build plan and milestone sequencing.                                                                                                                                          |
| `docs/design.md`              | Design system for the **authenticated product** (§15) — colors, spacing, components, motion for everything behind login.                                                                     |
| `docs/MAIN_DESIGN.md`         | Design system for the **public/marketing site** (landing, pricing, legal — unauthenticated).                                                                                                 |
| `docs/CLAUDE_CODE_PROMPTS.md` | The ordered list of build prompts this codebase was implemented against, one per feature slice.                                                                                              |

**On design conflicts**: `MAIN_DESIGN.md` governs the marketing surface.
`design.md` §15 governs the authenticated product. Where `MAIN_DESIGN.md` is
silent on a product need, `design.md` §15 fills the gap — silence in
`MAIN_DESIGN.md` is out of that document's scope, not an override.

## Current status

Verified against the actual code, not the PRD's description of intent. "Done"
means real endpoints/screens/logic exist and pass `lint`/`typecheck`/`test`;
"Partial" means a real but reduced-scope implementation with a documented gap
in the code itself; "Stub" means scaffold only, no feature code.

| App / package         | Status              | Notes                                                                                                                                                                                                                                                                |
| --------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`            | **Built**           | NestJS modular monolith. Auth, profile, availability, intents, matching/discovery, connections, messaging, notifications, trust & safety, admin, AI gateway, billing (stub — see below) all have real modules.                                                       |
| `apps/web`            | **Built**           | Next.js (App Router). Marketing site, auth, onboarding, home, discovery, chat, profile, settings, premium paywall, and an `(admin)` route group (the real admin console — `apps/admin` below is a decoy, see next row).                                              |
| `apps/realtime`       | **Built**           | Standalone WebSocket gateway (ticket-based auth, presence, conversation fan-out via Redis pub/sub).                                                                                                                                                                  |
| `apps/admin`          | **Stub only**       | Never built beyond the P0.1 scaffold — it has no `dev` script and no application code. The real admin console lives inside `apps/web`'s `(admin)` route group instead. Don't look here for admin functionality.                                                      |
| `apps/mobile`         | **Built**           | Expo/React Native. Auth, onboarding, availability, discovery, requests, chat with a hand-rolled WebSocket client and SQLite outbox. Native build/bundling has been verified with a hoisted `node_modules` layout, but that layout isn't checked in (see Known gaps). |
| `packages/db`         | **Built**           | Drizzle schema + 17 hand-written, forward-only migrations (each with a `.down.sql`).                                                                                                                                                                                 |
| `packages/matching`   | **Built**           | Scoring engine. The one package with a CI-enforced 100% coverage gate.                                                                                                                                                                                               |
| `packages/validation` | **Built**           | Shared Zod schemas — the only place request/response shapes are defined.                                                                                                                                                                                             |
| `packages/tokens`     | **Built**           | Design tokens, generated from `MAIN_DESIGN.md`.                                                                                                                                                                                                                      |
| `packages/ui`         | **Built (small)**   | A handful of shared primitives (Button, Card, Input, ...). Most product UI is hand-built per-screen in `apps/web`, not componentized here.                                                                                                                           |
| `packages/types`      | **Built (partial)** | Generated from `openapi/convene.v1.yaml` via `openapi-typescript`. Several operations in the spec are still placeholder/untyped — confirmed by reading `generated.ts` directly, not assumed.                                                                         |
| `packages/analytics`  | **Built**           | Typed event registry (compile-time-enforced taxonomy) and KPI/funnel/guardrail computation functions. Not wired to a live event pipeline (no PostHog/ClickHouse in this repo).                                                                                       |
| `packages/config`     | **Built**           | Shared ESLint/TypeScript config, including the module-boundary rule.                                                                                                                                                                                                 |

**Infra services declared but not actually consumed by the app**: MinIO
(S3-compatible storage) and Mailpit (SMTP capture) both run in
`docker-compose.yml`, but `apps/api`'s real code doesn't talk to either —
media is written to a local filesystem path (`MEDIA_STORAGE_ROOT`) and email
is a `console.log` stub (`ConsoleEmailTransport`). See "How the pieces
connect" and "Known gaps" for exactly what this means in practice.

## Prerequisites

| Tool                        | Version                                                            | Required?                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                     | `20.x` (`.nvmrc` pins `20`)                                        | Required. This session's own environment actually runs Node 24, which produces a `WARN Unsupported engine` on every `pnpm` command but has not caused a real failure — don't take that warning as fatal, but don't rely on it either; use 20 if you can.                                                                                                                                                      |
| pnpm                        | `10.33.0` (pinned in root `package.json`'s `packageManager` field) | Required.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Docker (or Colima on macOS) | Any recent version, with `docker compose`                          | Required for `docker-compose.yml` (Postgres/Redis/MinIO/Mailpit) and for the integration test suite (Testcontainers). **Unverified in this environment** — the `docker` binary itself is not installed here, so nothing in this README involving Docker has actually been run and confirmed working end-to-end in this session. The commands are real (read from the actual config files), just not executed. |

**What degrades without Docker**: everything that needs a real Postgres or
Redis — `apps/api` won't boot (`DATABASE_URL`/`REDIS_URL` are both required,
not optional, in `apps/api/src/config/env.schema.ts` — the process refuses
to start without them, by design), `apps/realtime` won't boot (`REDIS_URL`
required), and integration tests (`*.integration.test.ts`) skip themselves
automatically (they check `docker info` and self-skip via
`describe.skipIf(!dockerAvailable)` — this is why every `pnpm test` run in
this session shows tests "skipped," not failed). **Unit tests, E2E tests, and
the `apps/web` marketing pages do not need Docker** — E2E runs against a
hand-rolled mock of `apps/api`, not a real one (see Testing).

## First-time setup

```bash
git clone https://github.com/indkshitij/CONVENE.git
cd CONVENE
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed -- --users=200
pnpm dev
```

Step by step:

1. **Clone and install.** `pnpm install` installs every workspace's
   dependencies in one pass (pnpm workspace, not npm/yarn workspaces).
   Success looks like a "Done" line with no `ERR_PNPM_*` output.
2. **Copy the env file.** `.env.example` only covers the infra services
   (`docker-compose.yml` reads `POSTGRES_*`/`REDIS_*`/`MINIO_*`/`MAILPIT_*`
   from it). `apps/api` reads its own, separate set of variables directly
   from `process.env` — see "Environment variables" below for the full
   list and what each app actually needs.
3. **Bring infra up.** `docker compose up -d` starts Postgres 16 (with
   PostGIS/pgvector — see `docker/postgres`'s custom Dockerfile),
   Redis 7, MinIO, and Mailpit, plus a one-shot `minio-init` container that
   creates the `convene-media` bucket. Check it worked: `docker compose ps`
   — every service should show `healthy`, and `minio-init` should show
   `Exited (0)` (it's a one-shot init job, not a persistent service — that's
   correct, not a crash).
4. **Migrate.** `pnpm db:migrate` applies every not-yet-applied file in
   `packages/db/migrations/*.sql` in filename order, tracked in a
   `_migrations` bookkeeping table (idempotent — safe to re-run). Success:
   the script prints `apply 0000_identity.sql`, `apply 0001_profile_geo.sql`,
   ... ending in `Migrations up to date.`
5. **Seed.** `pnpm db:seed` alone only seeds reference taxonomies (skills,
   industries, interests, languages, cities) — always safe, always run it.
   Add `-- --users=200` (or any count) to also generate a deterministic,
   Bengaluru-dense population of fake users dense enough to make
   Discovery/Available-Now/messaging immediately exercisable without
   registering accounts by hand. **Seeded users have no password set** — you
   cannot log in as them; they exist for browsing/matching, not
   auth-flow testing. Success: `Done in N.NNs.`.
6. **Run everything.** `pnpm dev` (`turbo run dev --parallel`) starts every
   workspace member that has a `dev` script — today that's `apps/api`,
   `apps/web`, and `apps/realtime` (turbo silently skips packages without
   one, which is why `apps/admin`/`apps/mobile`/every `packages/*` don't
   start). See "Running the stack" for each one's port and what a working
   boot looks like.

**None of steps 3–6 have been executed in this session** — Docker isn't
available here. Every command above is read directly from the real
`docker-compose.yml`/`package.json` scripts, not copied from a doc, but "the
command is correct" and "this was run and confirmed working" are different
claims; only the former is true right now.

## Environment variables

### Infra (`.env`, read by `docker-compose.yml`)

| Variable              | Required?     | Local default   | Secret?                                                          |
| --------------------- | ------------- | --------------- | ---------------------------------------------------------------- |
| `POSTGRES_USER`       | No (defaults) | `convene`       | No                                                               |
| `POSTGRES_PASSWORD`   | No (defaults) | `convene`       | Yes in any shared/deployed environment — the default is dev-only |
| `POSTGRES_DB`         | No (defaults) | `convene`       | No                                                               |
| `POSTGRES_PORT`       | No (defaults) | `5432`          | No                                                               |
| `REDIS_PORT`          | No (defaults) | `6379`          | No                                                               |
| `MINIO_ROOT_USER`     | No (defaults) | `convene`       | Yes in any shared/deployed environment                           |
| `MINIO_ROOT_PASSWORD` | No (defaults) | `convene123`    | Yes in any shared/deployed environment                           |
| `MINIO_BUCKET`        | No (defaults) | `convene-media` | No                                                               |
| `MINIO_API_PORT`      | No (defaults) | `9000`          | No                                                               |
| `MINIO_CONSOLE_PORT`  | No (defaults) | `9001`          | No                                                               |
| `MAILPIT_SMTP_PORT`   | No (defaults) | `1025`          | No                                                               |
| `MAILPIT_UI_PORT`     | No (defaults) | `8025`          | No                                                               |

### `apps/api` (`apps/api/src/config/env.schema.ts`, validated with Zod at boot)

| Variable                                                    | Required?                            | Local default                                          | Secret?                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                  | No                                   | `development`                                          | No                                                                                                                         |
| `PORT`                                                      | No                                   | `8080`                                                 | No                                                                                                                         |
| `DATABASE_URL`                                              | **Yes** — boot fails without it      | `postgres://convene:convene@localhost:5432/convene`    | Yes (contains a password) once it's not the dev default                                                                    |
| `REDIS_URL`                                                 | **Yes** — boot fails without it      | `redis://localhost:6379`                               | No locally; yes if the Redis instance requires auth                                                                        |
| `LOG_LEVEL`                                                 | No                                   | `info`                                                 | No                                                                                                                         |
| `JWKS_KEYS_PATH`                                            | No                                   | `.keys/jwks-keys.json`                                 | The _file_ this points to is a secret (local JWT signing keys) — never commit `.keys/`                                     |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`     | No (optional)                        | unset                                                  | Secret if set — Google login throws a clear runtime error if a request needs it and it's missing, rather than failing boot |
| `LINKEDIN_OAUTH_CLIENT_ID` / `LINKEDIN_OAUTH_CLIENT_SECRET` | No (optional)                        | unset                                                  | Secret if set — same runtime-error-not-boot-failure behavior                                                               |
| `LOCATION_ENCRYPTION_KEY`                                   | No (optional, min 32 chars if set)   | unset                                                  | Secret — pgcrypto field-level key for coordinates. Location writes throw a clear error at call time if unset, not at boot  |
| `MEDIA_STORAGE_ROOT`                                        | No                                   | `.media-storage`                                       | No — local filesystem path, dev/test only (see "How the pieces connect")                                                   |
| `MEDIA_SIGNING_SECRET`                                      | No (has a dev default, min 32 chars) | `dev-only-media-signing-secret-not-for-production-use` | **Must be overridden and treated as a secret outside dev** — the shipped default is intentionally labeled unsafe           |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                               | No (optional)                        | unset                                                  | No                                                                                                                         |

**If a required variable is missing**: `apps/api` refuses to start.
`validateEnv()` runs before `NestFactory.create()`, so a malformed or missing
`DATABASE_URL`/`REDIS_URL` throws immediately with a message naming exactly
which field failed — this is deliberate (§21.5: "the process refuses to
start if any required variable is missing or malformed"), not an
accident to work around.

### `apps/realtime` (`apps/realtime/src/config/env.schema.ts`)

| Variable       | Required? | Local default                                                                                                                                            |
| -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | No        | `development`                                                                                                                                            |
| `PORT`         | No        | `8081`                                                                                                                                                   |
| `REDIS_URL`    | **Yes**   | `redis://localhost:6379`                                                                                                                                 |
| `API_BASE_URL` | **Yes**   | none — must point at a running `apps/api` (e.g. `http://localhost:8080`); the gateway verifies WS tickets against `{API_BASE_URL}/.well-known/jwks.json` |
| `LOG_LEVEL`    | No        | `info`                                                                                                                                                   |

### `apps/web` (read directly via `process.env`, not schema-validated)

| Variable                      | Required?                                                         | Local default                                      |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `API_BASE_URL`                | Effectively yes (server-only — BFF routes and `proxy.ts` read it) | `http://localhost:8080`                            |
| `NEXT_PUBLIC_REALTIME_WS_URL` | No                                                                | `ws://localhost:8081/socket`                       |
| `NEXT_PUBLIC_SITE_URL`        | No                                                                | `https://convene.example` (used for `sitemap.xml`) |
| `NEXT_PUBLIC_MEDIA_ORIGIN`    | No                                                                | falls back to `API_BASE_URL`'s origin              | Only needs setting if media is ever served from a different host than the API (e.g. a real CDN) |

`apps/web` has no `envSchema`/boot-time validation the way `apps/api` and
`apps/realtime` do — a missing var here degrades a specific feature (e.g.
realtime falls back to its own hard-coded `ws://localhost:8081/socket`
default) rather than refusing to start.

## Running the stack

### Infra services

| Service  | Image                                                                                   | Port(s)                           | UI / check                                                                                              |
| -------- | --------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Postgres | custom build, `docker/postgres` (16 + PostGIS + pgvector + pg_trgm + citext + pgcrypto) | `5432`                            | `psql postgres://convene:convene@localhost:5432/convene`                                                |
| Redis    | `redis:7-alpine`, append-only persistence                                               | `6379`                            | `redis-cli ping` → `PONG`                                                                               |
| MinIO    | `minio/minio:latest`                                                                    | `9000` (S3 API), `9001` (console) | http://localhost:9001, login `convene` / `convene123`                                                   |
| Mailpit  | `axllent/mailpit:latest`                                                                | `1025` (SMTP), `8025` (UI)        | http://localhost:8025 — **note**: nothing in `apps/api` actually sends mail through this yet, see below |

```bash
docker compose up -d
docker compose ps      # everything except minio-init should say "healthy"
docker compose logs -f # tail all services
docker compose down    # stop (add -v to also wipe volumes/data)
```

### Applications

| App             | Command                               | Port                                                         | You should see                                                                                                                        |
| --------------- | ------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`      | `pnpm --filter @convene/api dev`      | `8080`                                                       | `Convene API listening on port 8080 (development)` in the terminal; `curl http://localhost:8080/health` should respond                |
| `apps/web`      | `pnpm --filter @convene/web dev`      | `3000` (Next.js default — no `-p` flag set)                  | The marketing landing page at http://localhost:3000                                                                                   |
| `apps/realtime` | `pnpm --filter @convene/realtime dev` | `8081`                                                       | Gateway boot log; a WebSocket client can connect to `ws://localhost:8081/socket?ticket=...` once it has a real ticket from `apps/api` |
| `apps/admin`    | —                                     | —                                                            | No `dev` script exists. Nothing to run — see Current Status.                                                                          |
| `apps/mobile`   | `pnpm --filter @convene/mobile start` | Expo dev tools (no fixed port — Expo prints a QR code / URL) | Requires Expo Go on a device/simulator, or `pnpm --filter @convene/mobile ios`/`android`/`web`                                        |

**Run everything together**: `pnpm dev` from the repo root (`turbo run dev
--parallel`) starts `apps/api`, `apps/web`, and `apps/realtime`
concurrently — the three with a real `dev` script.

## How the pieces connect

```
┌─────────────┐  REST (Bearer token,     ┌─────────────┐
│  apps/web    │  proxied via BFF routes) │  apps/api    │
│  :3000       ├─────────────────────────►│  :8080       │
│  (Next.js)   │◄─────────────────────────┤  (NestJS)    │
└──────┬───────┘  JSON + httpOnly cookies └──────┬───────┘
       │                                          │
       │ WS ticket exchange:                      │ reads/writes
       │ 1. POST /api/realtime/ticket (BFF)        │
       │    → apps/web calls apps/api's            ▼
       │      POST /realtime/ticket with       ┌─────────┐
       │      the caller's Bearer token         │Postgres  │
       │ 2. apps/api mints a short-lived,       │  :5432   │
       │    single-use JWT ("ws_ticket")        └─────────┘
       │ 3. browser opens                            ▲
       │    ws://localhost:8081/socket?ticket=...    │ presence, cache,
       ▼                                              │ rate limits, AI
┌──────────────┐  verifies ticket via              │ quota/cache/circuit
│ apps/realtime │  GET {API_BASE_URL}/              │
│  :8081        │  .well-known/jwks.json  ──────────┤
│  (ws gateway) │                                    │
└──────┬────────┘                                    │
       │ subscribe/publish                           │
       ▼                                          ┌───▼───┐
┌──────────────┐  message.sent, presence.*  ◄──────┤ Redis │
│ Redis pub/sub │  fan-out between apps/api's        │ :6379 │
│ (same Redis   │  write path and every connected    └───────┘
│  instance)    │  apps/realtime replica
└──────────────┘
```

- **REST**: `apps/web` never calls `apps/api` directly from the browser.
  Every mutating/authenticated call goes through a Next.js Route Handler
  under `apps/web/app/api/**` (the "BFF" — backend-for-frontend) which holds
  the access token in an httpOnly cookie and attaches it as a
  `Authorization: Bearer` header when it calls the real `apps/api`. The
  browser never sees the access or refresh token directly. Wired by
  `API_BASE_URL` on the `apps/web` side.
- **Refresh cookie**: `apps/web/lib/auth/set-session-cookies.ts` sets three
  cookies: `access_token` (httpOnly, `SameSite=Lax`), `refresh_token`
  (httpOnly, `SameSite=Strict`, path-scoped to `/api/auth`), and
  `session_user` (httpOnly, `SameSite=Lax`, holds the non-secret profile
  summary the UI needs without a round trip). `apps/api`'s own
  `POST /auth/refresh` reads the refresh token _only_ from a literal
  `Cookie` header (never a bearer token or body field) — the BFF forwards
  its own httpOnly cookie value as a server-to-server `Cookie` header when
  it calls `apps/api`, so the two processes never share a browser cookie
  directly (different origins).
- **WebSocket ticket exchange**: the browser can't safely hold a long-lived
  credential for a raw `ws://` connection the way it can for
  `Authorization` headers on `fetch`. So: `apps/web`'s client calls its own
  `POST /api/realtime/ticket` BFF route (has the httpOnly access token,
  server-side) → that route calls `apps/api`'s real
  `POST /realtime/ticket` with a `Bearer` header → `apps/api` mints a
  60-second single-use JWT (`typ: "ws_ticket"`) → the browser gets _only_
  that ticket back and opens `ws://<realtime-host>/socket?ticket=...`
  directly. `apps/realtime` verifies the ticket by fetching
  `apps/api`'s own JWKS endpoint (`API_BASE_URL` env var on the realtime
  side) — it never talks to Postgres or holds a shared signing secret; any
  RS256-verifying service could do the same check.
- **Redis pub/sub fan-out**: when `apps/api` writes a message or an
  availability change, it publishes to a Redis channel
  (`apps/api/src/infra/redis/channels.ts`). Every `apps/realtime` replica
  subscribes to the channels its currently-connected clients care about and
  re-emits over the matching WebSocket connections. This is also why Redis
  being unreachable degrades presence/live-availability specifically (see
  `runbooks/redis-down.md`) — it's the only transport between the two
  processes.
- **Object storage / MinIO**: `docker-compose.yml` stands up a real MinIO
  instance and creates a bucket for it. **`apps/api`'s actual code does not
  use it.** `apps/api/src/modules/media/services/storage-provider.ts`'s only
  wired implementation is `LocalFilesystemStorageProvider`, writing to
  `MEDIA_STORAGE_ROOT` on the API process's own disk and serving signed URLs
  through `apps/api` itself (`GET /media/local-serve/:token`), not through
  MinIO or a CDN. This is a real, verified gap between the infra scaffold
  and the application code, not a documentation choice — see "Known gaps."
- **Shared packages both sides import**: `packages/validation` (the Zod
  schemas — request/response shapes are defined exactly once and imported
  by both `apps/api` and `apps/web`, never re-declared), `packages/types`
  (OpenAPI-generated types), `packages/matching` (scoring — imported by
  `apps/api` for real ranking, and by nothing on the client side today),
  `packages/tokens` (design tokens — consumed as CSS custom properties by
  `apps/web` and, for `apps/mobile`, as a NativeWind theme object built from
  the same source values).

**Symptoms of each hop being misconfigured**:

| Symptom                                                                     | Likely cause                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web` shows network errors on every authenticated page                 | `API_BASE_URL` wrong/unset, or `apps/api` isn't running                                                                                                                                            |
| Login works but every subsequent request 401s                               | The BFF's cookie-forwarding is broken, or `apps/api`'s `JWKS_KEYS_PATH` file doesn't exist/changed between requests (signing key mismatch)                                                         |
| Chat/presence never updates live, but REST calls work fine                  | `apps/realtime` isn't running, `NEXT_PUBLIC_REALTIME_WS_URL` points at the wrong host, or `apps/realtime`'s `API_BASE_URL` can't reach `apps/api`'s JWKS endpoint                                  |
| WS connects then immediately closes                                         | The ticket expired (60s single-use) before the browser opened the socket, or `apps/realtime`'s `REDIS_URL` doesn't match `apps/api`'s                                                              |
| Uploaded media 404s from a different host than the one you uploaded through | Expected today — media is served from `apps/api`'s own local disk, not a shared/CDN origin; don't point two different `apps/api` instances at the same `MEDIA_STORAGE_ROOT` expecting shared media |

## Database workflow

```bash
pnpm db:migrate                    # apply every pending migration, in order
pnpm db:rollback                   # roll back ONLY the single most recent migration
pnpm db:seed                       # taxonomies only
pnpm db:seed -- --users=200        # taxonomies + a fake user population
pnpm db:create-partitions          # creates the next period's messages partition
```

- **Migrations are hand-written SQL**, not `drizzle-kit generate` output —
  `packages/db/drizzle.config.ts`'s own comment states it's for
  introspection/studio only. Every `NNNN_name.sql` has a matching
  `NNNN_name.down.sql`; CLAUDE.md's rule is that every migration must apply
  _and_ roll back cleanly in dev before a change is considered done.
- **Forward-only, expand/contract**: never edit an already-applied migration
  file. A schema change that needs to happen is a _new_ migration that
  expands (adds a nullable column, a new table) in one release and contracts
  (drops the old column) in a later one, never a single migration that
  breaks anything reading the old shape mid-deploy.
- **No `db:reset` script exists.** To start over locally:
  `docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed`
  (the `-v` drops the Postgres volume — this is destructive, local-only).
- **Inspecting the database**: no `db:studio` script is wired up in
  `package.json`, but `packages/db/drizzle.config.ts` is a real, valid
  Drizzle config — `cd packages/db && npx drizzle-kit studio` should work
  (unverified in this session, no Docker to point it at).

## Testing

| Layer                                 | Command                                                                                                                                                                                              | Needs Docker?                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (one package)                    | `pnpm --filter @convene/api test` (swap the filter)                                                                                                                                                  | No                                                                                                                                                                                                                                                                                                                                              |
| Unit (one file)                       | `pnpm --filter @convene/api test -- src/modules/auth/services/auth.service.test.ts`                                                                                                                  | No                                                                                                                                                                                                                                                                                                                                              |
| Unit (everything)                     | `pnpm test` (`turbo run test`, every workspace)                                                                                                                                                      | Partially — see integration below                                                                                                                                                                                                                                                                                                               |
| Integration (`*.integration.test.ts`) | Included in the same `test` command above                                                                                                                                                            | **Yes** — uses Testcontainers (`@testcontainers/postgresql`, `@testcontainers/redis`); each suite calls `docker info` itself and self-skips (`describe.skipIf(!dockerAvailable)`) if Docker isn't reachable. This is why `pnpm test` in this session always reports a large "skipped" count, not a failure.                                     |
| Coverage                              | `pnpm exec turbo run test -- --coverage` (what CI actually runs)                                                                                                                                     | Same as above                                                                                                                                                                                                                                                                                                                                   |
| E2E                                   | `pnpm --filter @convene/web test:e2e` (Playwright)                                                                                                                                                   | **No** — runs against a hand-rolled mock of `apps/api` (`apps/web/tests/e2e/support/mock-api-server.ts`), started automatically by `playwright.config.ts` on port `3101`, alongside `apps/web` itself on port `3100`. Neither port matches the normal dev ports (`8080`/`3000`) — E2E is fully self-contained and doesn't touch the real stack. |
| E2E (one file)                        | `pnpm --filter @convene/web exec playwright test tests/e2e/auth-screens.spec.ts`                                                                                                                     | No                                                                                                                                                                                                                                                                                                                                              |
| Accessibility                         | Folded into E2E — spec files named `*-axe.spec.ts` run `@axe-core/playwright` against real rendered pages; `pnpm --filter @convene/web exec playwright test tests/e2e/*-axe.spec.ts` runs just those | No                                                                                                                                                                                                                                                                                                                                              |
| Load                                  | `k6 run load-tests/scenarios/discovery-feed.js` (swap the file; see `load-tests/README.md`)                                                                                                          | Needs a deployed target, not Docker specifically — **never executed in this session**, `k6` itself isn't installed here                                                                                                                                                                                                                         |

**Coverage floors**: `packages/matching/vitest.config.ts` sets a
CI-enforced 100% statement/branch/function/line threshold — the only
package with one. CLAUDE.md's stated rule is that permission policies also
require 100% coverage; in practice every policy in
`apps/api/src/common/auth/policies/` has its own test file, but there is
**no CI-enforced percentage gate** for that directory the way
`packages/matching` has one — an honest gap between the written rule and
what's actually mechanically enforced. `apps/api`'s own `vitest.config.mts`
has no coverage threshold configured at all.

## The quality gate

Run in this order, every time, before considering a change done:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All four must be clean. None of them may be made to pass by adding `any`,
`@ts-ignore`, an `eslint-disable` comment, or by deleting/skipping a test —
if one of these is failing, the fix is to fix the actual cause. If a
pre-existing failure blocks unrelated work, fix it and say so in the PR
description rather than working around it.

## Repo layout

```
apps/
  api/          NestJS modular monolith — the real backend
  web/          Next.js — marketing site + authenticated product + admin console
  realtime/     Standalone WebSocket gateway
  admin/        Stub only — no real code, see Current Status
  mobile/       Expo/React Native app
packages/
  db/           Drizzle schema, hand-written migrations, seed data
  matching/     Scoring engine (100%-coverage-gated)
  validation/   Shared Zod schemas — the one place shapes are defined
  types/        Generated types from openapi/convene.v1.yaml
  tokens/       Design tokens (generated from MAIN_DESIGN.md)
  ui/           A small set of shared UI primitives
  analytics/    Typed event registry + KPI/funnel/guardrail computation
  config/       Shared ESLint/TypeScript config, incl. the boundary rule below
```

**Module boundary rule**: apps must not import other apps, and packages must
not import apps — enforced by `packages/config/eslint.base.mjs`'s
`no-restricted-imports` rule (blocks both bare-specifier and relative-path
forms of a cross-app import), with a permanent fixture test proving the rule
actually fires (`packages/config/src/eslint-boundary.test.ts`), not just a
manually-reproduced-and-reverted check.

## Conventions

- **Commits**: Conventional Commits, enforced by commitlint
  (`commitlint.config.js` extends `@commitlint/config-conventional`) via a
  `commit-msg` husky hook.
- **Pre-commit**: `lint-staged` runs `prettier --check` (not `--write` — a
  badly formatted file fails the commit rather than being silently
  reformatted) on every staged `.ts/.tsx/.js/.mjs/.json/.md/.css` file, and
  `eslint --fix` on `.ts/.tsx`.
- **Branch protection / required reviewers**: `.github/CODEOWNERS` exists
  but has **every path commented out** — its own header comment says real
  GitHub usernames are needed from the project owner before it does
  anything, and that the "two-reviewer" requirement (referenced in
  `DEVELOPMENT_PLAN.md` and `CLAUDE.md`) additionally needs to be configured
  in the repository's branch protection settings, which this repo (a
  personal GitHub account, not an org) hasn't had done yet. Don't assume
  two-reviewer enforcement is active just because it's documented as policy.
- **PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) expects: what
  changed, which PRD sections were implemented, acceptance criteria met
  (checked off), anything deliberately left out, and a checklist covering
  the quality gate, `BR-*` test coverage, no hard-coded design values, no
  serialized coordinates, and migrations applying/rolling back cleanly.

## Troubleshooting

**Already hit in this repo's own history, with the real fix:**

| Problem                                                                                        | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind classes used inside `packages/ui` don't generate any CSS in `apps/web`                | Tailwind v4's content detection only scans `apps/web`'s own directory by default — `apps/web/app/globals.css` needs (and has) an explicit `@source "../../../packages/ui/src";` line for any sibling package's classNames to be picked up                                                                                                                                                                                                                   |
| React Testing Library tests see stale/duplicate DOM nodes across test cases                    | Missing `afterEach(cleanup)` — both `apps/web/src/test-setup.ts` and `packages/ui/src/test-setup.ts` register `cleanup()` from `@testing-library/react` after every test; a new test file that doesn't import this setup file will leak DOM between tests                                                                                                                                                                                                   |
| `size-limit` reports a bundle size that doesn't match what you'd expect from a route           | Turbopack's chunk filenames are content hashes with no semantic "this is the shared shell" prefix — `scripts/prepare-bundle-size-check.mjs` resolves this by reading `.next/build-manifest.json`'s `rootMainFiles`/`polyfillFiles` and concatenating exactly those into a stable-named file `size-limit` can target; if you add a new shared dependency and the number looks wrong, check that script's logic before assuming `size-limit` itself is broken |
| `pnpm install` fails or behaves oddly around `postcss`/`sharp`                                 | Root `package.json` has `pnpm.overrides` pinning `postcss >=8.5.18` and `sharp >=0.35.0` — some transitive dependency pulls an older, incompatible version otherwise                                                                                                                                                                                                                                                                                        |
| Pre-commit hook rejects a commit that looks fine                                               | It's running `prettier --check`, not `--write` — run `pnpm exec prettier --write <file>` yourself first, the hook will not auto-fix it for you                                                                                                                                                                                                                                                                                                              |
| Playwright E2E test flakes with a duplicate-element strict-mode violation, but passes on rerun | A known, confirmed-non-flaky-when-isolated dev-mode duplicate-DOM-node quirk under parallel test execution — rerun the single test in isolation (`--repeat-each=3`) before assuming it's a real regression; several existing specs use `.first()` or `toHaveCount(0)` specifically to route around this                                                                                                                                                     |

**Likely first-run failures:**

| Symptom                                                                                       | Cause                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api`/`apps/realtime` won't start, error mentions `DATABASE_URL` or `REDIS_URL`          | `.env` wasn't copied from `.env.example`, or `docker compose up -d` wasn't run first                                                                                                                                                                         |
| `EADDRINUSE` on `3000`/`8080`/`8081`                                                          | Something else already bound that port — `lsof -i :8080` (etc.) to find and kill it, or a previous `pnpm dev` didn't shut down cleanly                                                                                                                       |
| `docker compose up -d` hangs or a service never reaches `healthy`                             | Docker daemon isn't actually running (`docker info` should succeed first) — on macOS with Colima, `colima start` before compose                                                                                                                              |
| `pnpm db:migrate` fails partway through                                                       | Almost always means a migration was hand-edited after being applied elsewhere, or `_migrations` bookkeeping is out of sync with what's actually in the schema — don't hand-fix the table, restore from a known-good state (`docker compose down -v` locally) |
| A command that should be fast (`lint`/`typecheck`) seems to do nothing or gives stale results | Turbo's cache — `pnpm exec turbo run <task> --force` bypasses it for one run                                                                                                                                                                                 |

## Known gaps and unverified claims

Stated plainly, because a README that overstates what works is worse than a
short one:

- **Docker has never actually been run in this development session.** Every
  Docker-dependent command in this document (`docker compose up`, the
  integration test suite, the seed/migrate flow against a real database) is
  read directly from real config files, not copied from documentation, but
  none of it has been executed and confirmed working end-to-end here.
- **No database restore drill has been performed.** §21.9/§22.12 treat a
  restore verified inside a 60-minute RTO as a hard release gate. No backup
  or restore tooling exists in this repository at all yet (confirmed by
  search) — see `runbooks/database-restore-drill.md` for the intended
  procedure.
- **No load test has been executed.** `load-tests/` has real, runnable `k6`
  scenarios for the stated throughput/latency/connection-count targets, but
  `k6` isn't installed in this environment and there's no deployed
  environment to point it at. See `load-tests/README.md`.
- **No OWASP ZAP baseline scan has been run** — needs a deployed, running
  instance to scan.
- **Three of the seven §21.9 degradation-matrix rows have no code behind
  them**: Search-down (search runs on the same Postgres as everything else
  today, so "search down but the rest of the app up" isn't a real isolated
  failure mode in this architecture), read-replica-lag routing (no
  read-replica infrastructure or routing logic exists at all), and the
  object-storage/CDN fallback described in the PRD (no real object storage
  provider is wired up — see "How the pieces connect"). Full detail and
  what _is_ verified working per-row: `runbooks/`.
- **`apps/mobile`'s native build was verified once, under a temporary,
  not-committed `node_modules` layout** (`node-linker=hoisted` in a
  `.npmrc` that was added, tested, and then reverted because it broke an
  unrelated package's test suite). The mobile app typechecks/lints/tests
  clean under this repo's normal pnpm layout, but a real Metro/Expo bundle
  has not been produced under the config that's actually checked in.
- **CODEOWNERS and branch-protection two-reviewer enforcement are not
  actually configured** despite being documented policy — see Conventions.
- **MinIO and Mailpit run in `docker-compose.yml` but nothing in
  `apps/api` talks to either of them** — media is local-disk, email is a
  console-log stub. Don't expect uploaded media to appear in the MinIO
  console, or outgoing email to appear in Mailpit's UI, until those
  integrations are actually built.
- **148 FR-\* and 63 NFR-\* requirements from the PRD have been walked
  against real test/enforcement evidence** (not just described) — 22 FR-\*
  and 16 NFR-\* have no implementation or test evidence at all (including
  2FA/TOTP, GDPR data export, Apple Sign-In), and a further 47 FR-\*/33
  NFR-\* are only partially evidenced. Full table:
  `security/P29.3_ACCESSIBILITY_AND_TRACEABILITY.md`.
- **A full security threat-model walk exists** (`security/SECURITY_REVIEW_P29.2.md`)
  with real fixes applied (CSP, HSTS, an SSRF redirect-limit correction, a
  DB query-timeout addition) and open findings clearly separated from closed
  ones — CAPTCHA, TOTP MFA, and a payment-provider integration are all
  confirmed absent, not just undocumented.

**What a real deployment still needs, in rough priority order**: a real
object storage provider (R2/S3) wired into `apps/api`'s `StorageProvider`
interface, a real SMTP/transactional-email provider, a payment provider
(Stripe/Razorpay) and its webhook handling, backup/restore automation
against whatever managed Postgres is chosen, 2FA/TOTP for admin accounts,
and the branch-protection/CODEOWNERS configuration this repo's own docs
already assume is active.

## Where to pick up next

There is no next prompt — `docs/CLAUDE_CODE_PROMPTS.md`'s sequence ends at
P29.4 (this repo's most recently completed phase), which was itself the
last gate the PRD names before beta launch. The highest-value next work,
based on everything verified while writing this document, is closing the
gaps listed immediately above — particularly the ones with zero code behind
them (2FA, GDPR export, real object storage/email/payment providers) rather
than new product features, since those are named as launch-blocking
requirements the codebase doesn't meet yet.
