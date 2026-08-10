import {
  apiFetch,
  apiFetchWithHeaders,
  ApiError,
  type CompletionResult,
  type FullProfileResponse,
} from "@/lib/api/client";

// One fetcher, two callers: the profile view/edit Server Components'
// initial SSR fetch and the BFF route handlers' client refetch both call
// these, so the Query cache never has to distinguish where a page came
// from — same pattern as lib/discovery's fetchers.
export async function fetchOwnProfile(
  accessToken: string,
): Promise<{ data: FullProfileResponse; etag: string | null }> {
  const { data, headers } = await apiFetchWithHeaders<FullProfileResponse>("/profiles/me", {
    accessToken,
  });
  return { data, etag: headers.get("etag") };
}

export async function fetchCompletion(accessToken: string): Promise<CompletionResult> {
  return apiFetch<CompletionResult>("/profiles/me/completion", { accessToken });
}

// Returns null for every "unavailable" case apps/api can produce
// (nonexistent id, private profile, blocked) — deliberately collapsed
// into one outcome here too, mirroring app/api/profile/[userId]/route.ts's
// own collapse, so a Server Component calling this directly (the SSR
// path) can't accidentally render a different message than the BFF
// route's client-refetch path would.
export async function fetchProfileById(
  accessToken: string,
  userId: string,
): Promise<FullProfileResponse | null> {
  try {
    return await apiFetch<FullProfileResponse>(`/profiles/${userId}`, { accessToken });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}
