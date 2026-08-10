import {
  apiFetch,
  type AvailabilityMeResponse,
  type IntentResponse,
  type IntentTaxonomyEntry,
} from "@/lib/api/client";
import { requireSession } from "@/lib/auth/guards";
import { fetchDiscoveryWithProfiles } from "@/lib/discovery/fetch-discovery";
import { fetchMatchCandidate } from "@/lib/discovery/fetch-match-candidate";
import { MatchScreen } from "@/components/match/match-screen";

export const metadata = { robots: { index: false, follow: false } };

// design.md §14.9: "a focused, one-at-a-time review surface shown
// immediately after going available." The "stack" (progress "N of M",
// peek at next, auto-advance) is the same ordered candidate list a user
// would have just seen via GET /discover/available-now — there's no
// separate "session stack" endpoint or server-held position to read
// instead. A candidate reached via a direct link that isn't in this
// page's own available-now results simply renders as a stack of one
// (no position badge, no next), rather than fabricating a position.
export default async function MatchPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSession();
  const { userId } = await params;

  const [candidate, availability, ownIntents, taxonomy, stack] = await Promise.all([
    fetchMatchCandidate(session.accessToken, userId),
    apiFetch<AvailabilityMeResponse>("/availability/me", { accessToken: session.accessToken }),
    apiFetch<IntentResponse[]>("/intents", { accessToken: session.accessToken }),
    apiFetch<IntentTaxonomyEntry[]>("/intents/taxonomy", { accessToken: session.accessToken }),
    fetchDiscoveryWithProfiles(session.accessToken, "/discover/available-now"),
  ]);

  const stackIds = stack.data.map((match) => match.candidate_id);

  return (
    <MatchScreen
      initialCandidateId={userId}
      initialProfile={candidate.profile}
      initialExplanation={candidate.explanation}
      stackIds={stackIds.includes(userId) ? stackIds : [userId]}
      currentSession={availability.current_session}
      ownIntents={ownIntents}
      taxonomy={taxonomy}
    />
  );
}
