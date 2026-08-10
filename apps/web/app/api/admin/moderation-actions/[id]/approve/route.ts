import { safety as safetyValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type AdminModerationActionCard } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// P18.1 addition (§10.10.3's two-admin ban approval) — surfaces the
// already-real BAN_APPROVAL_SAME_ADMIN server check in the UI.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAdminSession();
  const { id } = await context.params;
  const parsed = safetyValidation.approveModerationActionSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<AdminModerationActionCard>(
      `/admin/moderation-actions/${id}/approve`,
      { method: "POST", accessToken: session.accessToken, body: parsed.data },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
