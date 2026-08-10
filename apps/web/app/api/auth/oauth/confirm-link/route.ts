import { auth as authValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type OAuthCallbackResult } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { setSessionCookies } from "@/lib/auth/set-session-cookies";

// §13 F1's link-confirmation step: the user proves ownership of their
// existing password-based account before it's linked to the OAuth
// identity the callback route detected.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = authValidation.oauthConfirmLinkSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const result = await apiFetch<OAuthCallbackResult>("/auth/oauth/confirm-link", {
      method: "POST",
      body: parsed.data,
    });
    if (!result.user || !result.tokens) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "That password didn't match.",
            field: "password",
            details: null,
            request_id: null,
            retry_after: null,
          },
        },
        { status: 401 },
      );
    }
    const response = NextResponse.json({ user: result.user });
    setSessionCookies(response, { user: result.user, tokens: result.tokens });
    return response;
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
