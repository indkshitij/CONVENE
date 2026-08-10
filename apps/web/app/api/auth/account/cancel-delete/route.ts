import { NextResponse } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.1.7 endpoint 11 (cancel-delete) — one-tap cancel during the
// grace window.
export async function POST(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<{ cancelled: true }>("/auth/account/cancel-delete", {
      method: "POST",
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
