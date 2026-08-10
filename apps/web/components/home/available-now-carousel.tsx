import { requireSession } from "@/lib/auth/guards";
import { fetchDiscoveryWithProfiles } from "@/lib/discovery/fetch-discovery";
import { AvailableNowCarouselClient } from "./available-now-carousel-client";

// design.md §14.7: "Available now near you (horizontal carousel)."
export async function AvailableNowCarousel() {
  const session = await requireSession();
  const data = await fetchDiscoveryWithProfiles(session.accessToken, "/discover/available-now");
  return <AvailableNowCarouselClient initialData={data} />;
}
