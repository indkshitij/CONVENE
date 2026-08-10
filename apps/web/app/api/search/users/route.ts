import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type SearchUsersResult } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.9.2: `GET /search/users` — passes the query string straight
// through, apps/api owns all parsing/validation (QUERY_TOO_SHORT,
// PREMIUM_FILTER_REQUIRED naming the exact filter, per design.md §14.16).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const query = request.nextUrl.search;

  try {
    const data = await apiFetch<SearchUsersResult>(`/search/users${query}`, {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
