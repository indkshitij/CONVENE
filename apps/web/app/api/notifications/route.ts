import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type NotificationsListResponse } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.8.3 endpoint 46: `GET /notifications?filter=`.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const filter = request.nextUrl.searchParams.get("filter");
  const path = filter ? `/notifications?filter=${encodeURIComponent(filter)}` : "/notifications";

  try {
    const data = await apiFetch<NotificationsListResponse>(path, {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
