import { auth as authValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type AuthResult } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { setSessionCookies } from "@/lib/auth/set-session-cookies";

// PRD §18.1 BFF route. Validates against the same Zod schema apps/api's
// own controller uses (packages/validation, never reimplemented), calls
// apps/api server-side, then sets httpOnly session cookies and returns
// only the user object to the browser — `tokens` never leaves this
// route handler.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = authValidation.loginSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const result = await apiFetch<AuthResult>("/auth/login", { method: "POST", body: parsed.data });
    const response = NextResponse.json({ user: result.user });
    setSessionCookies(response, result);
    return response;
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
