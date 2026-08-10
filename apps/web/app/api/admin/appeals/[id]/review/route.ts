import { safety as safetyValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type AdminAppealCard } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// P18.1 addition (§10.10.3's "reviewed by a different admin than the one
// who acted") — surfaces the already-real APPEAL_REVIEWER_CONFLICT
// server check in the UI.
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAdminSession();
  const { id } = await context.params;
  const parsed = safetyValidation.reviewAppealSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<AdminAppealCard>(`/admin/appeals/${id}/review`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
