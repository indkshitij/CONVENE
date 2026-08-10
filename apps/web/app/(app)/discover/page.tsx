import { requireSession } from "@/lib/auth/guards";
import { fetchDiscoveryWithProfiles } from "@/lib/discovery/fetch-discovery";
import { DiscoverFeed, type DiscoverSurface } from "@/components/discover/discover-feed";

export const metadata = { robots: { index: false, follow: false } };

function resolveSurface(value: string | undefined): DiscoverSurface {
  if (value === "available_now" || value === "global") return value;
  return "nearby";
}

function pathFor(surface: DiscoverSurface): string {
  return surface === "available_now" ? "/discover/available-now" : `/discover?tab=${surface}`;
}

// design.md §14.8: "Discovery (Tabbed: Available Now · Nearby · Global)"
// — the card is "the most important component in the product." Server
// Component fetches the first page for whichever tab the URL names
// (default nearby); DiscoverFeed (Client Component) owns tab-switching,
// cursor pagination, and virtualization thereafter.
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSession();
  const { tab } = await searchParams;
  const surface = resolveSurface(tab);
  const initialData = await fetchDiscoveryWithProfiles(session.accessToken, pathFor(surface));

  return <DiscoverFeed initialSurface={surface} initialData={initialData} />;
}
