import {
  apiFetch,
  ApiError,
  type CandidateDisplayProfile,
  type ProfileResponse,
} from "@/lib/api/client";

// GET /discover, /discover/available-now, and /connections/requests all
// return bare user ids (candidate_id / sender_id) with no name, avatar,
// headline, or distance — there is still no real batched "match card"
// endpoint (grepped again for P22.1; doesn't exist). This hydrates each
// id's display fields with a parallel GET /profiles/:userId call.
// Server-only (uses the caller's own access token).
export async function hydrateProfiles(
  accessToken: string,
  userIds: string[],
): Promise<Map<string, CandidateDisplayProfile>> {
  const uniqueIds = [...new Set(userIds)];
  const results = await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const profile = await apiFetch<ProfileResponse>(`/profiles/${id}`, { accessToken });
        return [id, profile] as const;
      } catch (error) {
        // A candidate/sender who 403/404s between the list query running
        // and this hydration (blocked, went private, deleted) is dropped
        // from the rendered set rather than failing the whole section.
        if (error instanceof ApiError) return null;
        throw error;
      }
    }),
  );

  const byId = new Map<string, CandidateDisplayProfile>();
  for (const entry of results) {
    if (!entry) continue;
    const [id, profile] = entry;
    byId.set(id, {
      full_name: profile.full_name,
      avatar: profile.avatar,
      headline: profile.headline,
      distance_bucket: profile.location.distance_bucket,
      city: profile.location.city,
      company: profile.company,
      verification_level: profile.verification.level,
      availability: profile.availability,
      primary_intent_type: profile.intents[0]?.type ?? null,
    });
  }
  return byId;
}
