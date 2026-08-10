import { safety as safetyValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type AdminReportCard } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// PRD §10.10 endpoint 63 (PATCH) — status/assignment updates from the
// report queue row.
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAdminSession();
  const { id } = await context.params;
  const parsed = safetyValidation.updateReportSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<AdminReportCard>(`/admin/reports/${id}`, {
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
