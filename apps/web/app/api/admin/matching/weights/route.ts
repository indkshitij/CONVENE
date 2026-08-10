import { matching as matchingValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type MatchingWeights } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// PRD AD-8/§11.11 — GET/PUT /admin/matching/weights.
export async function GET(): Promise<NextResponse> {
  const session = await requireAdminSession();
  try {
    const data = await apiFetch<MatchingWeights>("/admin/matching/weights", {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await requireAdminSession();
  const parsed = matchingValidation.updateMatchingWeightsSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<MatchingWeights>("/admin/matching/weights", {
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
