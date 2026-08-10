import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type OAuthCallbackResult } from "@/lib/api/client";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms-version";
import { setSessionCookies } from "@/lib/auth/set-session-cookies";

// This is the `redirect_uri` the start route registered with apps/api —
// the OAuth provider redirects the *browser* here via a plain GET with
// `?code=&state=` in the query string (not a fetch the client makes), so
// this has to be a page-navigation-producing route (a redirect response),
// not a JSON API the client would otherwise call.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await context.params;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?oauth_error=missing_params", request.url));
  }

  try {
    const result = await apiFetch<OAuthCallbackResult>(`/auth/oauth/${provider}/callback`, {
      method: "POST",
      body: { code, state, accepted_terms_version: CURRENT_TERMS_VERSION },
    });

    // §13 F1: "OAuth email matches existing account? Yes -> Explicit
    // link confirmation + password check." The account isn't logged in
    // yet — the user must prove they own the existing password-based
    // account before the two get linked.
    if (result.link_confirmation_required && result.link_token) {
      const url = new URL("/oauth-link", request.url);
      url.searchParams.set("token", result.link_token);
      url.searchParams.set("provider", provider);
      return NextResponse.redirect(url);
    }

    if (result.user && result.tokens) {
      const response = NextResponse.redirect(new URL("/home", request.url));
      setSessionCookies(response, { user: result.user, tokens: result.tokens });
      return response;
    }

    return NextResponse.redirect(new URL("/login?oauth_error=failed", request.url));
  } catch (err) {
    const code = err instanceof ApiError ? err.code : "OAUTH_FAILED";
    return NextResponse.redirect(
      new URL(`/login?oauth_error=${encodeURIComponent(code)}`, request.url),
    );
  }
}
