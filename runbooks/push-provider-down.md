# Runbook: Push provider unavailable

**Alert**: elevated `failed`/`invalid_token` rate from `PushSender`
(`apps/api/src/modules/notifications/services/push-sender.ts` and callers).

**Design commitment (§21.9)**: "In-app notifications continue; a digest
email is sent for high-priority categories."

## What's verified working today

This is a fully real, tested degradation path:

- **In-app notifications are written independent of push delivery.**
  `notifications.service.ts` always writes the in-app row first; push is a
  best-effort side effect on top of it, so a push-provider outage can never
  prevent the in-app notification centre from working.
- **Digest-email fallback for high-priority categories when push fails** —
  `notifications.service.ts:192` (comment citing §21.9 verbatim), with the
  actual fallback call at the push-failure branch. Directly tested:
  `notifications.service.test.ts:185` — "prunes an invalid push token and
  falls back to email for high-priority categories," using a
  `fakePushSender("invalid_token")` to simulate exactly this failure mode.
- **Invalid tokens are pruned automatically** (`notifications.service.ts:186`,
  BR-NOTIF-06) — so a provider returning "this device token is no longer
  valid" (the most common real-world push failure) self-heals the device
  registry rather than repeatedly failing on the same dead token.

## Manual mitigation

1. Confirm the failure is provider-side (FCM/APNs/Web Push outage) vs.
   isolated invalid tokens — the latter self-heals automatically per above.
2. No manual intervention needed for high-priority categories — they
   already fall back to email.
3. Non-high-priority categories have no documented email fallback (matches
   the PRD row, which only names high-priority) — users on those categories
   simply won't get a push until the provider recovers; the in-app centre
   still has the notification waiting.

## Exercising this drill for real

Point the push-sender configuration at an unreachable/invalid provider
endpoint and confirm the email fallback fires for a real high-priority
notification send, end to end (not just the unit-test double). Not
performed in this pass — no live FCM/APNs/Web-Push credentials configured in
this environment to intentionally break.
