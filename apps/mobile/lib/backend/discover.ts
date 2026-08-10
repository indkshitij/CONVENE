import { apiFetch } from "./client";

// Mirrors apps/web's MatchCard/DiscoveryResponse (apps/api's
// discovery.controller.ts) — GET /discover. Deliberately the RAW
// candidate_id/score/reasons shape, with no per-candidate profile
// hydration (unlike web's BFF, which fans out a GET /profiles/:userId
// per card) — mobile has no server tier to do that fan-out server-side,
// and doing it as N client-side requests per page is a documented scope
// cut for this lean pass, not an oversight.
export type DiscoveryEmptyStateReason =
  "no_supply" | "all_filtered" | "all_seen" | "profile_incomplete";

export interface MatchCard {
  candidate_id: string;
  score: number;
  reasons: string[];
  expansion_stage: number;
  location_tier: number;
}

export interface DiscoveryResponse {
  data: MatchCard[];
  meta: { next_cursor: string | null; has_more: boolean; expansion_stage: number };
  empty_state: DiscoveryEmptyStateReason | null;
}

export function getDiscoveryFeed(accessToken: string, cursor?: string): Promise<DiscoveryResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<DiscoveryResponse>(`/discover${query}`, { accessToken });
}
