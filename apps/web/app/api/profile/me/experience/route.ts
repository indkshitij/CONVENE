import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.2.9 (POST /profiles/me/experience). apps/api validates this
// body inside the service, not via a route-level Zod pipe — the §10.2.7
// start_date floor needs the caller's own DOB, which experienceCreateSchema
// takes as a factory argument the client has no business computing itself.
// This route forwards the raw body and lets apps/api's own validation
// produce the error, matching what profile-children.controller.ts does.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const body = await request.json();

  try {
    const data = await apiFetch("/profiles/me/experience", {
      method: "POST",
      accessToken: session.accessToken,
      body,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
