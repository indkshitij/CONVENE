import { NextResponse } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §17.9 endpoint 36: `DELETE /blocks/:userId` — unblock.
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { userId } = await context.params;

  try {
    await apiFetch(`/blocks/${userId}`, { method: "DELETE", accessToken: session.accessToken });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
