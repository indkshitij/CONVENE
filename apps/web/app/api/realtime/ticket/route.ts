import { NextResponse } from "next/server";
import { ApiError, apiFetch, type WsTicketResponse } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { getSession } from "@/lib/auth/session";

// P19.2: the access token is httpOnly (P19.1) — client JS has no
// credential to call apps/api's own POST /realtime/ticket directly. This
// route does it server-side (where the access token is readable) and
// hands back only the short-lived, single-use ticket, which is safe to
// expose to client JS precisely because it's narrow (WS-connect-only)
// and expires in 60s — unlike the access token itself, which never
// leaves this route.
export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication is required.",
          field: null,
          details: null,
          request_id: null,
          retry_after: null,
        },
      },
      { status: 401 },
    );
  }

  try {
    const result = await apiFetch<WsTicketResponse>("/realtime/ticket", {
      method: "POST",
      accessToken: session.accessToken,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
