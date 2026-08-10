import type { HydratedRequestCard } from "@/lib/api/client";

// BR-CONN-03: "Rejection is silent to the sender — the request continues
// to display as 'Pending' until it naturally expires." apps/api's own
// GET /connections/requests?direction=sent does NOT actually implement
// this — connections.service.ts's rejectRequest sets status:"rejected"
// directly on the row the sender's own query reads, and listRequests has
// no masking logic despite a code comment there claiming otherwise
// (verified by reading connections.repository.ts/service.ts directly).
// P23.1's own acceptance line scopes the fix explicitly to "the UI
// layer" — this is that fix: for a sent request, a true `rejected`
// status is displayed as `pending` for as long as `expires_at` is still
// in the future, and as `expired` once it passes — exactly the same
// transition an ordinarily-still-pending request goes through, so a
// rejected request is indistinguishable from one that simply timed out.
// Applied in fetch-requests.ts (both the BFF route and any SSR fetch)
// rather than only in a component, so the raw network response never
// carries the real status either, not just the rendered UI.
export function maskSilentRejection(
  request: HydratedRequestCard,
  direction: "received" | "sent",
  now: Date = new Date(),
): HydratedRequestCard {
  if (direction !== "sent" || request.status !== "rejected") return request;
  const stillActive = new Date(request.expires_at).getTime() > now.getTime();
  return { ...request, status: stillActive ? "pending" : "expired" };
}
