import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type City } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";

// PRD's taxonomy.controller.ts GET /taxonomies/cities returns raw
// `cities` rows (packages/db/src/schema/geo.ts), which include a
// `centroid` column — a city's own public approximate coordinates, not
// any individual user's location, but still a coordinate field. CLAUDE.md
// rule 5 ("never serialise coordinates... a DTO whitelist mapper is
// mandatory on every response") is read as covering this literally: every
// response, not just user-location ones. Unlike the industries BFF route
// (a plain passthrough — Industry has no coordinate field to begin with),
// this route maps to an explicit whitelist instead of forwarding
// apps/api's JSON verbatim, so `centroid` never reaches the browser. The
// deeper fact that taxonomy.controller.ts's own response already includes
// it is a pre-existing gap in that controller, out of scope to fix here
// (not a file this phase touches) — flagged in the PR description.
interface RawCity {
  id: number;
  name: string;
  stateId: number | null;
  countryCode: string | null;
  population: number | null;
  timezone: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const path = query ? `/taxonomies/cities?q=${encodeURIComponent(query)}` : "/taxonomies/cities";

  try {
    const data = await apiFetch<{ cities: RawCity[] }>(path);
    const cities: City[] = data.cities.map((city) => ({
      id: city.id,
      name: city.name,
      country: city.countryCode,
    }));
    return NextResponse.json({ cities });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
