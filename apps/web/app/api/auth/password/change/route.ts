import { auth as authValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.1.7 endpoint 8 (change) — design.md §14.18's "Password &
// security" row.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = authValidation.passwordChangeSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch("/auth/password/change", {
      method: "POST",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
