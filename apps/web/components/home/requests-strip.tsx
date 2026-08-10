import { requireSession } from "@/lib/auth/guards";
import { fetchRequestsWithSenders } from "@/lib/discovery/fetch-requests";
import { RequestsStripClient } from "./requests-strip-client";

// design.md §14.7: "Requests (horizontal, max 5, ranked)." Server
// Component does the first fetch (streamed independently inside its own
// <Suspense> in home/page.tsx); RequestsStripClient hydrates a
// useQuery from this and owns updates thereafter (§18.3).
export async function RequestsStrip() {
  const session = await requireSession();
  const data = await fetchRequestsWithSenders(session.accessToken, {
    direction: "received",
    status: "pending",
    sort: "score_desc",
  });
  return <RequestsStripClient initialData={data} />;
}
