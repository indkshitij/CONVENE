import { requireSession } from "@/lib/auth/guards";
import { fetchDiscoveryWithProfiles } from "@/lib/discovery/fetch-discovery";
import { TopMatchesListClient } from "./top-matches-list-client";

// design.md §14.7: "Top matches for you (vertical list, 5)."
export async function TopMatchesList() {
  const session = await requireSession();
  const data = await fetchDiscoveryWithProfiles(session.accessToken, "/discover?tab=nearby");
  return <TopMatchesListClient initialData={data} />;
}
