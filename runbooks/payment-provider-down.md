# Runbook: Payment provider unavailable

**Alert**: elevated error rate on checkout/subscription endpoints.

**Design commitment (§21.9)**: "Existing entitlements honoured from the
local subscription record; new checkouts disabled."

## What exists today

Confirmed during P29.2's security review and P29.3's traceability walk: no
Stripe or Razorpay integration exists anywhere in this codebase.
`apps/api/src/modules/billing/` contains only `entitlements.controller.ts`
and `entitlements.service.ts` — the latter's own comment states plan is
"honestly always 'free'... until the billing module has real subscription
rows." There is no webhook handler, no checkout endpoint, nothing a payment
provider outage could actually affect yet.

**This makes the PRD row vacuously true today**: entitlements are already
always read server-side from the (currently stub) subscription state, never
from the client or token — confirmed real
(`entitlements.service.ts`). New checkouts are already unconditionally
unavailable, because checkout doesn't exist, not because of an outage.

## Manual mitigation

Not applicable — there is no live payment path to degrade.

## Exercising this drill for real

Not exercisable until Stripe/Razorpay are actually integrated. When that
work lands, this runbook needs real content: which webhook signature checks
exist, what the entitlements-read path does when the provider's API is
unreachable (as opposed to just reading local state, which it already
does), and what UI copy explains a disabled checkout button.
