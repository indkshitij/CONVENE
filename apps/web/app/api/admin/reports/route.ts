import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type AdminReportCard } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// PRD §10.10 endpoint 63 (GET) — the report queue, `mod` in §17.9's
// endpoint table maps to both admin and moderator (§17.4 RBAC).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireAdminSession();
  const query = request.nextUrl.search;

  try {
    const data = await apiFetch<{ reports: AdminReportCard[] }>(`/admin/reports${query}`, {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
