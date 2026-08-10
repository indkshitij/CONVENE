# Runbook: KPI guardrail breach

**Alert**: any of §21.1's five guardrails crossing its threshold.

**Design commitment (§21.4)**: "Business monitoring: Grafana on ClickHouse
— WMC, activation and paid conversion on the same wall as the technical
dashboards, deliberately."

## What exists today

The five guardrail thresholds and the breach-check logic are real, tested
code — `packages/analytics/src/kpi/guardrails.ts` (built in P28.2):
`GUARDRAIL_THRESHOLDS` transcribes §21.1's row exactly, and
`checkGuardrailBreaches()` correctly distinguishes the one inclusive ("≤")
guardrail (`top_decile_inbound_requests_per_week`) from the four strict
("<") ones, confirmed by dedicated boundary tests.

**Not built**: the pipeline that computes real `GuardrailMetrics` from
production data and calls this function on a schedule, and the alerting rule
that fires when it returns a non-empty breach list. `checkGuardrailBreaches`
is a pure function waiting for a caller — same "logic exists, wiring
doesn't" pattern as the `FakeProfileDetectionService` gap P29.2 found, and
the ClickHouse/Grafana business-monitoring stack itself doesn't exist in
this codebase (confirmed elsewhere — same "no live instance in this dev
environment" category as Flagsmith/Stripe/a real object-storage provider).

## Response by guardrail

| Guardrail                             | What it means when it breaches                                         | First response                                                                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unsolicited-message complaints ≥2%    | The intent-floor gate or spam classifier is under-blocking             | Check `moderation-fast-path.service.ts`/`toxicity-spam-classifier.service.ts` error rates first — a breach here is often a classifier outage (see `llm-provider-down.md`), not a genuine spike                         |
| Top-decile inbound requests >25/wk    | A small set of high-profile users are being overwhelmed                | Check `inbound-filters.service.ts`'s throttle is actually engaging for the affected users; a breach here with throttles healthy suggests the 25/wk ceiling itself needs revisiting, not a bug                          |
| Global-tier feed share ≥40%           | Too many users are falling through to the widest match-expansion stage | Check `expansion.service.ts`'s stage-0-through-5 distribution — a spike usually means a supply problem in specific cities, not a matching-algorithm bug                                                                |
| AI-drafted first messages ≥60%        | Icebreakers are being over-relied on relative to manual composition    | Not a safety issue by itself — a product/UX signal, route to growth, not on-call                                                                                                                                       |
| Zero-match availability sessions ≥15% | Users are going available and finding nobody                           | Check `match-precompute.service.ts`'s job health first (a precompute outage would masquerade as a supply problem); if precompute is healthy, this is a genuine liquidity issue for whichever cities/times are affected |

## Exercising this drill for real

Requires the not-yet-built computation pipeline above. Once it exists: feed
it a deliberately bad metric snapshot (e.g., a synthetic 90% AI-drafted-message
rate) and confirm the alert fires and routes to the right channel. Not
performed in this pass — the pipeline doesn't exist yet to exercise.
