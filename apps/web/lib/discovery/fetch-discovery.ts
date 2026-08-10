import { apiFetch, type DiscoveryResponse, type HydratedDiscoveryResponse } from "@/lib/api/client";
import { hydrateProfiles } from "./hydrate-profiles";

// Shared by app/api/discover/route.ts + app/api/discover/available-now/route.ts
// (the client's refetch path) and components/home/*.tsx (the initial SSR
// fetch) — see fetch-requests.ts's own comment for why sharing this
// matters.
export async function fetchDiscoveryWithProfiles(
  accessToken: string,
  path: string,
): Promise<HydratedDiscoveryResponse> {
  const result = await apiFetch<DiscoveryResponse>(path, { accessToken });
  const profiles = await hydrateProfiles(
    accessToken,
    result.data.map((match) => match.candidate_id),
  );

  return {
    ...result,
    data: result.data.map((match) => ({
      ...match,
      profile: profiles.get(match.candidate_id) ?? null,
    })),
  };
}
