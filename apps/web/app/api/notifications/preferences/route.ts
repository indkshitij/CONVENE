import { notifications as notificationsValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type NotificationPreferencesResponse } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.8.3: `GET/PUT /notifications/preferences` — design.md §14.18's
// Notifications settings section (category × channel matrix).
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<NotificationPreferencesResponse>("/notifications/preferences", {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = notificationsValidation.updateNotificationPreferencesSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<NotificationPreferencesResponse>("/notifications/preferences", {
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
