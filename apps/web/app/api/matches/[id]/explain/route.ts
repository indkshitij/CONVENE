import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";
import { fetchMatchExplanation } from "@/lib/discovery/fetch-explain";

// PRD §17.9 endpoint 30: `GET /matches/:id/explain` — design.md §14.9's
// expandable sub-score breakdown ("Why? ▾").
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { id } = await context.params;

  try {
    const data = await fetchMatchExplanation(session.accessToken, id);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
