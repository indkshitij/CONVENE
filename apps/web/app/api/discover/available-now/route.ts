import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";
import { fetchDiscoveryWithProfiles } from "@/lib/discovery/fetch-discovery";

// PRD §17.9 endpoint 29: `GET /discover/available-now | Live availability
// feed` — design.md §14.7's "Available now near you" carousel.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const cursor = request.nextUrl.searchParams.get("cursor");
  const path = cursor
    ? `/discover/available-now?cursor=${encodeURIComponent(cursor)}`
    : "/discover/available-now";

  try {
    const data = await fetchDiscoveryWithProfiles(session.accessToken, path);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
