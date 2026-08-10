import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type OAuthStartResult } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";

// apps/api only implements google/linkedin (oauthProviderSchema — see
// packages/validation/src/auth.ts). design.md's own wireframe shows a
// third Apple button, and registerSchema.method's enum even includes
// "apple", but no OAuthProvider service exists for it anywhere in
// apps/api — a real spec/implementation gap, not something to silently
// paper over with a button that has nowhere to POST. Only these two are
// wired up.
const SUPPORTED_PROVIDERS = new Set(["google", "linkedin"]);

// PRD §13.2/apps/api's own oauth.controller.ts: `start` is a POST JSON
// endpoint (not a server redirect), so the flow here is: the browser
// calls this BFF route, gets back `authorizeUrl`, and navigates itself
// there (`window.location.assign`) — apps/api tracks `state` server-side
// (Redis, TTL) for the callback to verify, so this route is a thin,
// unauthenticated passthrough with one addition: it computes
// `redirect_uri` from this request's own origin rather than trusting a
// client-supplied one (an open-redirect risk otherwise).
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await context.params;
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return NextResponse.json(
      {
        error: {
          code: "OAUTH_PROVIDER_UNKNOWN",
          message: "This sign-in method isn't available.",
          field: null,
          details: null,
          request_id: null,
          retry_after: null,
        },
      },
      { status: 400 },
    );
  }

  const redirectUri = new URL(`/api/auth/oauth/${provider}/callback`, request.url).toString();

  try {
    const result = await apiFetch<OAuthStartResult>(`/auth/oauth/${provider}/start`, {
      method: "POST",
      body: { redirect_uri: redirectUri },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
