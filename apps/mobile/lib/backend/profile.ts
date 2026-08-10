import { apiFetchWithHeaders } from "./client";

// PRD §10.2.9: `PATCH /profiles/me` — optimistic concurrency via
// If-Match. Onboarding only ever touches a handful of scalar fields
// here (headline/job_title) — skills/experience/education/etc. each
// have their own dedicated endpoint and aren't part of this phase's
// lean onboarding pass.
export interface ProfileUpdateInput {
  headline?: string;
  job_title?: string;
}

export async function getOwnProfileEtag(accessToken: string): Promise<string | null> {
  const { headers } = await apiFetchWithHeaders<unknown>("/profiles/me", { accessToken });
  return headers.get("etag");
}

export async function updateOwnProfile(
  accessToken: string,
  ifMatch: string,
  input: ProfileUpdateInput,
): Promise<void> {
  await apiFetchWithHeaders<unknown>("/profiles/me", {
    method: "PATCH",
    accessToken,
    headers: { "If-Match": ifMatch },
    body: input,
  });
}
