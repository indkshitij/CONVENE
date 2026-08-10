import { Suspense } from "react";
import { AvailabilityCard } from "@/components/availability/availability-card";
import { AvailableNowCarousel } from "@/components/home/available-now-carousel";
import { RequestsStrip } from "@/components/home/requests-strip";
import { CarouselSkeleton, ListSkeleton, StripSkeleton } from "@/components/home/section-skeleton";
import { TopMatchesList } from "@/components/home/top-matches-list";

// design.md §14.7 in full. Documented section order: availability
// control · Convene Hour countdown · requests strip · Available Now
// carousel · top matches · AI suggestion card.
//
// Two sections are deliberately not built here — both have zero backend
// support (grepped, not assumed):
//   - Convene Hour countdown: matching.service.ts's own comment says the
//     feature "needs a [capability] this phase doesn't [have]" — no
//     endpoint, no data anywhere.
//   - AI weekly suggestion card: apps/api/src/modules/ai-gateway is an
//     empty module skeleton (`@Module({})`), P3.1's own placeholder —
//     no suggestion-generation endpoint exists.
// Same "flag the gap, don't fabricate" precedent as every other
// unbuilt-backend gap this session has hit (Apple OAuth, LinkedIn
// import, availability scheduling).
//
// Each remaining section is its own Server Component wrapped in an
// independent <Suspense> boundary (§18.2: "Server Component fetches the
// first page ... streamed via Suspense; React Query hydrates and owns
// updates thereafter") — a slow one streams in on its own without
// blocking the others. AvailabilityCard is unaffected by any of this: it
// was already a fully client-fetched Query component (P21.1), so a slow
// server-streamed section can't delay it by construction, not just by
// convention.
//
// Layout: single column in DOM/reading order (availability, requests,
// available-now, top-matches) at every width; ≥lg additionally
// repositions requests into a right rail via grid-template-areas (a
// visual reflow only — DOM order, and therefore keyboard/screen-reader
// order, doesn't change) per design.md's "availability + matches left
// (main), requests ... right (rail)."
export default function HomePage() {
  return (
    <div className="grid grid-cols-1 gap-[var(--spacing-24)] px-[var(--spacing-24)] py-[var(--spacing-40)] lg:grid-cols-[2fr_1fr] lg:[grid-template-areas:'availability_requests'_'available-now_requests'_'top-matches_requests']">
      {/* design.md's wireframe header (logo/bell/avatar) is the shared
          app chrome (SidebarNav/BottomTabBar, P19.1), not a per-page
          title — this stays visually hidden so the page still has the
          single <h1> every route needs (axe: page-has-heading-one). */}
      <h1 className="sr-only">Home</h1>

      <div className="lg:[grid-area:availability]">
        <AvailabilityCard />
      </div>

      <div className="lg:[grid-area:requests]">
        <Suspense fallback={<StripSkeleton />}>
          <RequestsStrip />
        </Suspense>
      </div>

      <div className="lg:[grid-area:available-now]">
        <Suspense fallback={<CarouselSkeleton />}>
          <AvailableNowCarousel />
        </Suspense>
      </div>

      <div className="lg:[grid-area:top-matches]">
        <Suspense fallback={<ListSkeleton />}>
          <TopMatchesList />
        </Suspense>
      </div>
    </div>
  );
}
