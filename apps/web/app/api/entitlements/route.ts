import { NextResponse } from "next/server";
import { ApiError, apiFetch, type EntitlementsResult } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// P24.2's own Implementation line: "Entitlements read from the server on
// every gated action."
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<EntitlementsResult>("/entitlements", {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
