import {
  apiFetch,
  type HydratedRequestsListResponse,
  type RequestsListResponse,
} from "@/lib/api/client";
import { hydrateProfiles } from "./hydrate-profiles";
import { maskSilentRejection } from "./mask-silent-rejection";

// Shared by app/api/connections/requests/route.ts (the client's refetch
// path) and components/home/requests-strip.tsx (the initial SSR fetch) so
// both produce the exact same shape — the Query cache never has to
// distinguish "came from the server render" from "came from a client
// refetch."
export async function fetchRequestsWithSenders(
  accessToken: string,
  params: {
    direction?: string | undefined;
    status?: string | undefined;
    sort?: string | undefined;
    cursor?: string | undefined;
  } = {},
): Promise<HydratedRequestsListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const path =
    query.size > 0 ? `/connections/requests?${query.toString()}` : "/connections/requests";

  const result = await apiFetch<RequestsListResponse>(path, { accessToken });
  // The person worth showing on the card depends on direction: for
  // "sent" requests, sender_id is the caller's own id (nothing to
  // hydrate/display) — the counterparty is recipient_id instead. A
  // request card's own `status`/`sender_id`/`recipient_id` fields don't
  // say which direction produced them, so this trusts the same `params.
  // direction` the caller queried with (defaulting to "received", this
  // function's original-only behavior, since an un-parameterized call —
  // still valid, e.g. an unfiltered admin-style listing — has no other
  // way to know).
  const isSent = params.direction === "sent";
  const counterpartyIds = result.requests.map((request) =>
    isSent ? request.recipient_id : request.sender_id,
  );
  const profiles = await hydrateProfiles(accessToken, counterpartyIds);

  const direction = isSent ? "sent" : "received";
  return {
    ...result,
    requests: result.requests.map((request) =>
      maskSilentRejection(
        {
          ...request,
          counterparty: profiles.get(isSent ? request.recipient_id : request.sender_id) ?? null,
        },
        direction,
      ),
    ),
  };
}
