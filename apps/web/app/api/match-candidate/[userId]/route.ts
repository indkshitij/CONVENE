import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";
import { fetchMatchCandidate } from "@/lib/discovery/fetch-match-candidate";

// Combined profile + score-explanation fetch for one candidate — used by
// the match screen (P22.2) as the user advances through the stack
// client-side (Skip/Connect), without a full page navigation per card.
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { userId } = await context.params;

  try {
    const data = await fetchMatchCandidate(session.accessToken, userId);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
