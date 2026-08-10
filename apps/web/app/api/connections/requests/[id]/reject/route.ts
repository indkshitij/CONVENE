import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// §10.6.6: `POST /connections/requests/:id/reject -> 204` (recipient
// only). BR-CONN-03: silent to the sender — see mask-silent-rejection.ts
// for how the sender's own list view never learns this happened.
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { id } = await context.params;

  try {
    await apiFetch(`/connections/requests/${id}/reject`, {
      method: "POST",
      accessToken: session.accessToken,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
