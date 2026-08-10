import { NextResponse } from "next/server";
import { ApiError, apiFetch, type SessionSummary } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.1.7 endpoint 9 (GET) — design.md §14.18's "Active sessions" row.
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<{ sessions: SessionSummary[] }>("/auth/sessions", {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
