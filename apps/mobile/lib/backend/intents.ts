import { apiFetch } from "./client";

// Mirrors apps/web's IntentTaxonomyEntry/IntentResponse (apps/api's
// intent-taxonomy.ts / intents.service.ts) — GET /intents/taxonomy (14
// static types) and POST /intents. No prerequisite-dimming logic here
// (unlike web's onboarding step 4) — a documented scope cut; a rejected
// prerequisite still surfaces honestly as apps/api's own 422
// INTENT_PREREQUISITE_UNMET error, just not pre-empted client-side.
export interface IntentTaxonomyEntry {
  type: string;
  label: string;
  category: string;
  complements: string[];
  peerMatch: string | null;
  prerequisites: string[];
}

export interface IntentResponse {
  id: string;
  type: string;
  detail: string | null;
  is_primary: boolean;
  status: string;
  expires_at: string;
}

export function getIntentTaxonomy(accessToken: string): Promise<IntentTaxonomyEntry[]> {
  return apiFetch<IntentTaxonomyEntry[]>("/intents/taxonomy", { accessToken });
}

export function createIntent(
  accessToken: string,
  type: string,
  expiresInDays: number,
): Promise<{ intent: IntentResponse }> {
  return apiFetch<{ intent: IntentResponse }>("/intents", {
    method: "POST",
    accessToken,
    body: { type, expires_in_days: expiresInDays },
  });
}
