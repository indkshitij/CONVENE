import { messaging as messagingValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.7.6: `POST /conversations/:id/read { up_to_sequence }`.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { id } = await context.params;
  const parsed = messagingValidation.markReadSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<{ unread_count: number; last_read_seq: number }>(
      `/conversations/${id}/read`,
      { method: "POST", accessToken: session.accessToken, body: parsed.data },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
