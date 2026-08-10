import { apiFetch, type ScoreExplanation } from "@/lib/api/client";

// Shared by app/api/matches/[id]/explain/route.ts (the client's refetch
// path) and the match screen's own Server Component (the initial SSR
// fetch) — same "one fetcher, two callers" pattern as fetch-discovery.ts
// and fetch-requests.ts.
export async function fetchMatchExplanation(
  accessToken: string,
  candidateId: string,
): Promise<ScoreExplanation> {
  return apiFetch<ScoreExplanation>(`/matches/${candidateId}/explain`, { accessToken });
}
