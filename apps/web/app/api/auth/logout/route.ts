import { NextResponse, type NextRequest } from "next/server";
import { apiFetch } from "@/lib/api/client";
import { clearSessionCookies } from "@/lib/auth/set-session-cookies";
import { REFRESH_TOKEN_COOKIE } from "@/lib/auth/session";

// Best-effort: even if apps/api's own revoke call fails (e.g. the
// refresh token was already expired), the browser's session cookies are
// cleared regardless — the user's own client-side session ends either
// way, which is what "logout" means from here.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (refreshToken) {
    await apiFetch("/auth/logout", { method: "POST", refreshTokenCookie: refreshToken }).catch(
      () => undefined,
    );
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
