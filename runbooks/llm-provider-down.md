# Runbook: LLM provider unavailable

**Alert**: elevated error rate / timeout rate from the AI gateway's model
provider calls (`apps/api/src/modules/ai-gateway/router.service.ts`).

**Design commitment (§21.9)**: "All AI features show a clear 'unavailable,
try later' state; manual paths (write your own message) remain fully
functional; moderation falls back to the classifier plus a stricter
threshold."

## What's verified working today

- **Feature-level circuit breaker.** `router.service.ts:58` —
  `CIRCUIT_FAILURE_THRESHOLD = 3` consecutive failures opens the circuit for
  that feature (Redis-tracked cooldown key), short-circuiting further calls
  without hitting the provider again until it cools down.
- **8s timeout + one jittered retry** per model call before falling through
  to the failure path (`router.service.ts`, `withTimeout()`).
- **`mode: "feature"` fails open to `{status: "unavailable"}`** — every
  user-facing AI feature (icebreakers, profile optimisation, resume review,
  conversation summary, career guidance, networking suggestions) is wired
  through `AiGatewayService.invoke()` with this mode, confirmed by reading
  each feature service's own `gateway.invoke({..., mode: "feature"})` call.
  The frontend (`apps/web`) treats `{status: "unavailable"}` as the honest
  degraded state and falls back to manual/static paths — e.g.
  `request-composer.tsx` falls back to curated static templates when
  icebreakers return `unavailable`, never a fabricated result.
- **`mode: "safety"` fails closed to `{status: "held_for_review"}`** — the
  toxicity/spam classifier (`toxicity-spam-classifier.service.ts`) uses this
  mode; a provider outage means content is held for human review rather
  than allowed through unchecked. This is the "stricter threshold" fallback
  the PRD describes, implemented as "hold everything" rather than a
  separate non-LLM classifier — a stricter but simpler interpretation than
  literally running "the classifier" (a separate model) independently, since
  no separate non-LLM classifier exists in this codebase.

This is the most completely-implemented row in the whole degradation
matrix — every sub-claim in the PRD row has real, traceable code behind it.

## Manual mitigation

1. Confirm via `apps/api`'s AI-gateway logs/metrics which feature(s) have
   open circuits.
2. No manual intervention is required for user-facing features — they
   degrade automatically and safely.
3. If moderation is failing closed broadly (many messages held for review),
   escalate to trust & safety on-call — `held_for_review` messages queue up
   for human review, they don't disappear, but a prolonged outage will
   create a backlog against the SLA table in
   `apps/api/src/modules/trust-safety/report-catalogue.ts`.

## Exercising this drill for real

Point `AI_MODEL_PROVIDER`'s real implementation (once one exists beyond
`DeterministicStubAiModelProvider`) at an unreachable endpoint, or block
egress to the provider, and confirm circuits open within 3 consecutive
failures and every feature surface degrades as described. Not performed in
this pass — this environment has no live LLM provider configured to kill in
the first place (the stub provider always succeeds deterministically).
