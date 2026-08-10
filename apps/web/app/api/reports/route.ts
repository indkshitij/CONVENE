import { safety as safetyValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type ReportResult } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.10 endpoint 50: `POST /reports` — the match card's "Report"
// action in the ⋯ menu.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = safetyValidation.createReportSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<ReportResult>("/reports", {
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
