import { apiFetch, type Industry } from "@/lib/api/client";
import { requireSession } from "@/lib/auth/guards";
import { fetchCompletion, fetchOwnProfile } from "@/lib/profile/fetch-profile";
import { EditProfileScreen } from "@/components/profile/edit-profile-screen";

export const metadata = { robots: { index: false, follow: false } };

// PRD §18.2: "Edit Profile — Client with server-prefetched initial data."
export default async function ProfileEditPage() {
  const session = await requireSession();
  const [{ data: profile, etag }, completion, industries] = await Promise.all([
    fetchOwnProfile(session.accessToken),
    fetchCompletion(session.accessToken),
    apiFetch<{ industries: Industry[] }>("/taxonomies/industries"),
  ]);

  return (
    <EditProfileScreen
      initialProfile={profile}
      initialEtag={etag}
      initialCompletion={completion}
      industries={industries.industries}
    />
  );
}
