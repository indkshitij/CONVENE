import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type AdminAppealCard } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// P26.1 addition (?status=pending) for the appeals review queue UI — see
// AdminAppealsController.list()'s own comment.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireAdminSession();
  const query = request.nextUrl.search;

  try {
    const data = await apiFetch<{ appeals: AdminAppealCard[] }>(`/admin/appeals${query}`, {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
