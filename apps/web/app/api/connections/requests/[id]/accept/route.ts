import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// §10.6.6: `POST /connections/requests/:id/accept -> 200 { connection,
// conversation }` (recipient only). BR-CONN-08: atomically creates the
// connection and a conversation with the request's note as the first
// message.
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { id } = await context.params;

  try {
    const data = await apiFetch<{
      connection: { id: string; connected_at: string };
      conversation: { id: string; first_message_id: string };
    }>(`/connections/requests/${id}/accept`, { method: "POST", accessToken: session.accessToken });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
