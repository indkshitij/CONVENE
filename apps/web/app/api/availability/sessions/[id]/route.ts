import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type EndSessionSummary } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.3.8: `DELETE /availability/sessions/:id` — ends early, returns
// the session summary. This route was missing from P20.3 even though
// go-available-form.tsx's "End this session instead" button already
// called it — a real gap from that phase, closed here since P21.1 needs
// the exact same endpoint for the countdown card's "End early" action.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { id } = await context.params;

  try {
    const data = await apiFetch<EndSessionSummary>(`/availability/sessions/${id}`, {
      method: "DELETE",
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
