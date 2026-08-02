# Convene

A real-time intent-based professional networking platform.

## Monorepo layout

- `apps/web` — Next.js web/PWA client
- `apps/api` — NestJS modular monolith API (stub)
- `apps/realtime` — WebSocket gateway (stub)
- `apps/admin` — Admin console (stub, Phase 26)
- `apps/mobile` — React Native app (stub, Phase 27)
- `packages/db` — Drizzle schema, migrations and data-access layer (Phase 2)
- `packages/tokens` — Design tokens (Phase 1)
- `packages/ui` — Shared UI primitives (Phase 1)
- `packages/types` — Generated API types
- `packages/validation` — Shared Zod schemas
- `packages/matching` — Matching/scoring engine (Phase 4/12)
- `packages/analytics` — Analytics event contracts
- `packages/config` — Shared ESLint/TypeScript config

## Getting started

```bash
pnpm install
pnpm dev        # runs apps/web on http://localhost:3000
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Requires Node 20 (see `.nvmrc`) and pnpm >= 10.

See `docs/Convene-PRD-v1.0.md`, `docs/design.md` (authenticated product) and `docs/MAIN_DESIGN.md` (marketing surface) for product/architecture and UI source of truth, and `CLAUDE.md` for the standing engineering rules that govern every change.
