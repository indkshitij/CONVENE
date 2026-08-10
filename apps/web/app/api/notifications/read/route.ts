import { notifications as notificationsValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.8.3: `POST /notifications/read { ids:[...] } | { all: true }`
// — also the design.md §14.17 "Mark all read" action (`{ all: true }`).
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = notificationsValidation.markNotificationsReadSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    await apiFetch("/notifications/read", {
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
