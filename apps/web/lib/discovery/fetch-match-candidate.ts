import type { CandidateDisplayProfile, ScoreExplanation } from "@/lib/api/client";
import { fetchMatchExplanation } from "./fetch-explain";
import { hydrateProfiles } from "./hydrate-profiles";

export interface MatchCandidateData {
  profile: CandidateDisplayProfile | null;
  explanation: ScoreExplanation | null;
}

// Shared by app/api/match-candidate/[userId]/route.ts (the client's own
// fetch as it advances through the stack) and the match screen's Server
// Component (the initial candidate) — same "one fetcher, two callers"
// pattern as fetch-discovery.ts/fetch-requests.ts/fetch-explain.ts.
export async function fetchMatchCandidate(
  accessToken: string,
  candidateId: string,
): Promise<MatchCandidateData> {
  const [profiles, explanation] = await Promise.all([
    hydrateProfiles(accessToken, [candidateId]),
    fetchMatchExplanation(accessToken, candidateId).catch(() => null),
  ]);
  return { profile: profiles.get(candidateId) ?? null, explanation };
}
