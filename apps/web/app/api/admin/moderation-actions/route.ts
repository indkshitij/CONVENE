import { safety as safetyValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type AdminModerationActionCard } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// PRD §10.10 endpoint 64. GET (?status=pending_approval) is a P26.1
// addition for the ban-approval queue UI — see
// AdminModerationActionsController.list()'s own comment.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireAdminSession();
  const query = request.nextUrl.search;

  try {
    const data = await apiFetch<{ moderation_actions: AdminModerationActionCard[] }>(
      `/admin/moderation-actions${query}`,
      { accessToken: session.accessToken },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireAdminSession();
  const parsed = safetyValidation.applyModerationActionSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<AdminModerationActionCard>("/admin/moderation-actions", {
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
