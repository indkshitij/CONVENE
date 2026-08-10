import { connections as connectionsValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type SendConnectionRequestResult } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";
import { fetchRequestsWithSenders } from "@/lib/discovery/fetch-requests";

// PRD §17.9 endpoint 34: `GET /connections/requests | direction=received|sent`
// — design.md §14.7's "Requests" strip (received, ranked by score).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const params = request.nextUrl.searchParams;
  try {
    const data = await fetchRequestsWithSenders(session.accessToken, {
      direction: params.get("direction") ?? undefined,
      status: params.get("status") ?? undefined,
      sort: params.get("sort") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}

// PRD §17.9 endpoint 32: `POST /connections/requests | Send request (202
// if throttled)` — the match screen's (P22.2) minimal Connect flow.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = connectionsValidation.createConnectionRequestSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<SendConnectionRequestResult>("/connections/requests", {
      method: "POST",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    // apps/api itself decides 201 vs 202 (BR-CONN throttling) — mirrored
    // through rather than the BFF re-deciding a status code it doesn't
    // have the throttle state to compute.
    return NextResponse.json(data, { status: data.queued_position !== undefined ? 202 : 201 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
