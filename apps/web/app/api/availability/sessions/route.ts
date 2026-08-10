import { availability as availabilityValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type CreateSessionResult } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.3.8: `POST /availability/sessions`. The route-level pipe on
// apps/api's own controller always validates against the Premium (loosest)
// duration bound and re-checks the real plan-specific bound inside the
// service (availability.controller.ts's own comment) — this BFF route
// mirrors that by validating with the same loose bound; the authoritative
// check still happens server-side in apps/api.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = availabilityValidation.createSessionSchema(true).safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<CreateSessionResult>("/availability/sessions", {
      method: "POST",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
