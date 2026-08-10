import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";
import { fetchConversations, type ConversationFilter } from "@/lib/chat/fetch-conversations";

const FILTERS: ConversationFilter[] = ["all", "unread", "pinned", "archived"];

// PRD §17.9 endpoint 37: `GET /conversations?filter=all|unread|pinned|archived`
// — design.md §14.12's Chat List.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const filterParam = request.nextUrl.searchParams.get("filter");
  const filter: ConversationFilter = FILTERS.includes(filterParam as ConversationFilter)
    ? (filterParam as ConversationFilter)
    : "all";

  try {
    const data = await fetchConversations(session.accessToken, filter);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
