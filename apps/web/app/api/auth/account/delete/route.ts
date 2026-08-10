import { NextResponse } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.1.7 endpoint 11 (delete) — design.md §14.18's "Delete account"
// row, §20.6's 30-day grace window.
export async function POST(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<{ purge_scheduled_at: string }>("/auth/account/delete", {
      method: "POST",
      accessToken: session.accessToken,
    });
    return NextResponse.json(data, { status: 202 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
