import { NextResponse } from "next/server";
import { apiFetch, type Industry } from "@/lib/api/client";

// PRD's taxonomy.controller.ts: GET /taxonomies/industries, policy
// publicReferenceData — no auth required on apps/api's side, but the
// client still can't reach apps/api directly (no CORS/public exposure
// is set up for that origin), so this thin passthrough exists like
// every other BFF route.
export async function GET(): Promise<NextResponse> {
  const data = await apiFetch<{ industries: Industry[] }>("/taxonomies/industries");
  return NextResponse.json(data);
}
