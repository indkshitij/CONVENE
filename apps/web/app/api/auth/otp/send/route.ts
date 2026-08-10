import { auth as authValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";

// No cookies to set — OTP send doesn't authenticate anyone, it just
// dispatches a code. A thin pass-through, but still routed through the
// BFF (not called directly from the browser) so every apps/api call
// site stays consistent and server-only.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = authValidation.otpSendSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const result = await apiFetch<{ expires_in: number; resend_available_in: number }>(
      "/auth/otp/send",
      { method: "POST", body: parsed.data },
    );
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
