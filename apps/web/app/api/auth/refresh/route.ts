import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type RefreshResult } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { clearSessionCookies } from "@/lib/auth/set-session-cookies";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/auth/session";

const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// apps/api's own POST /auth/refresh authenticates off a raw `refresh_token`
// Cookie header (readCookie() in auth.controller.ts) rather than a bearer
// token or body field — this route forwards the value out of our own
// httpOnly cookie as a server-to-server Cookie header (see
// ApiFetchOptions.refreshTokenCookie's own comment for why apps/api and
// apps/web can't just share a browser cookie across origins).
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REFRESH_TOKEN",
          message: "No session to refresh.",
          field: null,
          details: null,
          request_id: null,
          retry_after: null,
        },
      },
      { status: 401 },
    );
  }

  try {
    const result = await apiFetch<RefreshResult>("/auth/refresh", {
      method: "POST",
      refreshTokenCookie: refreshToken,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: ACCESS_TOKEN_COOKIE,
      value: result.tokens.access_token,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: result.tokens.expires_in,
    });
    response.cookies.set({
      name: REFRESH_TOKEN_COOKIE,
      value: result.tokens.refresh_token,
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/api/auth",
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    if (err instanceof ApiError) {
      // A rejected refresh (expired/reused token) means the session is
      // dead either way — clear our own cookies so the client doesn't
      // keep retrying against a session apps/api has already revoked.
      const response = apiErrorResponse(err);
      clearSessionCookies(response);
      return response;
    }
    throw err;
  }
}
