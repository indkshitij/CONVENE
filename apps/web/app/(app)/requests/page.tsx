import { apiFetch, type IntentTaxonomyEntry } from "@/lib/api/client";
import { requireSession } from "@/lib/auth/guards";
import { fetchRequestsWithSenders } from "@/lib/discovery/fetch-requests";
import { RequestsScreen } from "@/components/requests/requests-screen";

export const metadata = { robots: { index: false, follow: false } };

// design.md §14.11: "Received (3) / Sent (7)" tabs. Received defaults to
// pending only (the only ones needing action); Sent has no status filter
// so the full history — including the masked-as-pending-or-expired rows
// mask-silent-rejection.ts produces — is available to render.
export default async function RequestsPage() {
  const session = await requireSession();
  const [received, taxonomy] = await Promise.all([
    fetchRequestsWithSenders(session.accessToken, {
      direction: "received",
      status: "pending",
      sort: "score_desc",
    }),
    apiFetch<IntentTaxonomyEntry[]>("/intents/taxonomy", { accessToken: session.accessToken }),
  ]);

  return <RequestsScreen initialReceived={received} taxonomy={taxonomy} />;
}
