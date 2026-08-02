## What changed

<!-- One paragraph or bullet list. -->

## PRD sections implemented

<!-- e.g. BR-AVAIL-08, §10.3. "None" if this PR is pure tooling/infra. -->

## Acceptance criteria met

<!-- Copy the prompt's acceptance criteria and check them off. -->

- [ ]

## Deliberately left out

<!-- Anything explicitly out of scope for this PR, and why. "None" if nothing was left out. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass locally
- [ ] Every new business rule (`BR-*`) has a test
- [ ] No hard-coded design values (colour/spacing/radius/font/duration) outside `packages/tokens`
- [ ] No coordinates serialised in any API response
- [ ] Migrations (if any) apply and roll back cleanly
- [ ] Commit messages follow Conventional Commits
