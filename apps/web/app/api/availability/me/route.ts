import { NextResponse } from "next/server";
import { ApiError, apiFetch, type AvailabilityMeResponse } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<AvailabilityMeResponse>("/availability/me", {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
