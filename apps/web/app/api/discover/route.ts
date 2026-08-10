import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";
import { fetchDiscoveryWithProfiles } from "@/lib/discovery/fetch-discovery";

// PRD §17.9 endpoint 28: `GET /discover | Ranked feed (tab, cursor)` —
// this is design.md §14.7's "Top matches" section's real data source.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const tab = request.nextUrl.searchParams.get("tab");
  const cursor = request.nextUrl.searchParams.get("cursor");
  const query = new URLSearchParams();
  if (tab) query.set("tab", tab);
  if (cursor) query.set("cursor", cursor);
  const path = query.size > 0 ? `/discover?${query.toString()}` : "/discover";

  try {
    const data = await fetchDiscoveryWithProfiles(session.accessToken, path);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
