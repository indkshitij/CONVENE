import { messaging as messagingValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.7.6: `PATCH /conversations/:id { is_pinned?, muted_until?,
// is_archived? }` — design.md §14.12's pin/mute/archive actions.
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { id } = await context.params;
  const parsed = messagingValidation.updateConversationSettingsSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    await apiFetch(`/conversations/${id}`, {
      method: "PATCH",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
