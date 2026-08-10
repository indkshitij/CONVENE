import type { IntentResponse, IntentTaxonomyEntry } from "@/lib/api/client";

// design.md §14.10: "Intent selector defaulting to the best complement
// from the matrix." The real complementarity matrix (§11.5.2) lives in
// remote config server-side — not exposed to the client — but
// intent-taxonomy.ts's own `complements` field (returned by GET
// /intents/taxonomy) already lists each type's principal complementary
// edges, which is enough to pick a real, non-arbitrary default: the
// caller's own active intent whose `complements` list includes the
// recipient's primary intent type.
export function bestComplementIntentId(
  ownIntents: IntentResponse[],
  taxonomy: IntentTaxonomyEntry[],
  recipientPrimaryIntentType: string | null,
): string | null {
  if (ownIntents.length === 0) return null;
  if (recipientPrimaryIntentType) {
    const complementary = ownIntents.find((intent) => {
      const entry = taxonomy.find((taxonomyEntry) => taxonomyEntry.type === intent.type);
      return entry?.complements.includes(recipientPrimaryIntentType) ?? false;
    });
    if (complementary) return complementary.id;
  }
  const primary = ownIntents.find((intent) => intent.is_primary);
  return (primary ?? ownIntents[0])?.id ?? null;
}
