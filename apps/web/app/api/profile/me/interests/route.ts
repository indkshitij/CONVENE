import { profile as profileValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.2.9: "PUT /profiles/me/interests — full replace." Same
// no-If-Match reasoning as .../skills — full-replace endpoints don't
// need optimistic concurrency.
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = profileValidation.interestsListSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch("/profiles/me/interests", {
      method: "PUT",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
