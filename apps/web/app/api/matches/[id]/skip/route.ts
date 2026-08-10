import { matching as matchingValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §17.9 endpoint 31: `POST /matches/:id/skip`. BR-11.8: suppresses
// this candidate from the viewer's future feeds — the "Not interested"
// action on a match card.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { id } = await context.params;
  const parsed = matchingValidation.skipMatchSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    await apiFetch(`/matches/${id}/skip`, {
      method: "POST",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
