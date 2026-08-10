import { NextResponse } from "next/server";
import { ApiError, apiFetch, type AdminReportContent } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// P26.1: the report queue's row-expansion content view — apps/api writes
// the audit row itself before returning (AdminReportsController.content()'s
// own comment), this route is a plain proxy.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAdminSession();
  const { id } = await context.params;

  try {
    const data = await apiFetch<AdminReportContent>(`/admin/reports/${id}/content`, {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
