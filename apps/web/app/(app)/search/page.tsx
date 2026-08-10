import { apiFetch, type Industry, type IntentTaxonomyEntry } from "@/lib/api/client";
import { requireSession } from "@/lib/auth/guards";
import { SearchScreen } from "@/components/search/search-screen";

export const metadata = { robots: { index: false, follow: false } };

// design.md §14.16. Results themselves are always fetched client-side
// (the query only exists once the user types), so this Server Component
// only prefetches the two filter option lists.
export default async function SearchPage() {
  const session = await requireSession();
  const [industries, taxonomy] = await Promise.all([
    apiFetch<{ industries: Industry[] }>("/taxonomies/industries"),
    apiFetch<IntentTaxonomyEntry[]>("/intents/taxonomy", { accessToken: session.accessToken }),
  ]);

  return <SearchScreen industries={industries.industries} taxonomy={taxonomy} />;
}
