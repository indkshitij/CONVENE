import { requireSession } from "@/lib/auth/guards";
import { fetchCompletion, fetchProfileById } from "@/lib/profile/fetch-profile";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { ProfileUnavailable } from "@/components/profile/profile-unavailable";

export const metadata = { robots: { index: false, follow: false } };

// design.md §14.14: "Own vs other-user variants" of one screen, not two
// routes — apps/api's GET /profiles/:userId already handles the caller
// viewing their own id (relationship.status becomes "self", and
// profile_completion is included), so this route never special-cases
// self by calling /profiles/me instead.
export default async function ProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSession();
  const { userId } = await params;
  const isSelf = userId === session.user.id;

  const [profile, completion] = await Promise.all([
    fetchProfileById(session.accessToken, userId),
    isSelf ? fetchCompletion(session.accessToken) : Promise.resolve(null),
  ]);

  if (!profile) return <ProfileUnavailable />;

  return <ProfileScreen profile={profile} completion={completion} isSelf={isSelf} />;
}
