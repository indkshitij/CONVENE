@AGENTS.md

You are working on Convene, a real-time intent-based professional networking platform.

AUTHORITATIVE DOCUMENTS

- docs/Convene-PRD-v1.0.md — product, architecture, business rules. Section references
  like §10.3 or BR-AVAIL-08 always point here.
- docs/MAIN_DESIGN.md governs the marketing surface (colors, typography, components,
  layouts, spacing, responsiveness, animations for the public/unauthenticated site).
  docs/design.md §15 governs the authenticated product. Where MAIN_DESIGN.md is
  silent on a product need, design.md §15 fills the gap — silence in MAIN_DESIGN.md
  is not an override, it's simply out of that document's scope.

NON-NEGOTIABLE RULES

1. Scope discipline. Implement ONLY what the current prompt asks. Do not refactor
   unrelated code, do not "improve" adjacent files, do not add features not requested.
   If you believe something outside scope is broken, note it in the PR description
   and leave it alone.
2. Preserve existing functionality. Never delete or rewrite working code to make your
   change easier. Extend, don't replace.
3. The app must build after every prompt. Before you finish, run in this order and fix
   everything until all four are clean:
   pnpm lint → pnpm typecheck → pnpm test → pnpm build
   Do not silence errors with `any`, `@ts-ignore`, `eslint-disable`, or by deleting
   tests. Fix the actual cause. If a pre-existing failure blocks you, fix it and say
   so in the PR description.
4. No hard-coded design values. Colours, spacing, radii, font sizes, motion durations
   come from packages/tokens only. ESLint and Stylelint enforce this.
5. Never serialise coordinates. Location leaves the server only as a distance bucket
   or a city name. A DTO whitelist mapper is mandatory on every response.
6. Shared logic lives in packages/*. Never reimplement a Zod schema or a scoring
   function on the client.
7. Migrations are forward-only and expand/contract. Every migration must apply and
   roll back cleanly in dev before you finish.
8. Tests are part of the change, not a follow-up. Every business rule with a BR- id
   gets at least one test. packages/matching and all permission policies require 100%
   coverage.
9. Accessibility is not optional: keyboard operable, correct roles and names, ≥4.5:1
   contrast, ≥44×44px touch targets, prefers-reduced-motion honoured.
10. Conventional commit message. PR description must list: what changed, PRD sections
    implemented, acceptance criteria met, and anything deliberately left out.

WHEN BLOCKED
State the ambiguity, choose the option most consistent with the PRD, implement it,
and flag the assumption in the PR description. Do not stall and do not silently guess.
