import { matching as matchingValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type MatchingWeights } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireAdminSession } from "@/lib/auth/guards";

// P26.2: "rollback to the previous configuration in one action."
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireAdminSession();
  const parsed = matchingValidation.rollbackMatchingWeightsSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<MatchingWeights>("/admin/matching/weights/rollback", {
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
