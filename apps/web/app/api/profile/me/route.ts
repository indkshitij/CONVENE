import { profile as profileValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetchWithHeaders, type FullProfileResponse } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";
import { fetchOwnProfile } from "@/lib/profile/fetch-profile";

// apps/api's GET /profiles/me carries an ETag (set globally by that
// service's own EtagInterceptor); PATCH requires it back as If-Match
// for optimistic concurrency (profile.controller.ts). This route
// forwards both directions rather than the client ever calling apps/api
// itself — same reasoning as every other BFF route (the access token is
// httpOnly, server-only). Response typed as FullProfileResponse (the
// real, richer shape) now that P24.1's edit screen needs more than
// P20.3's onboarding-only subset — a strict superset, so existing
// onboarding call sites reading only their own fields are unaffected.
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const { data, etag } = await fetchOwnProfile(session.accessToken);
    const response = NextResponse.json(data);
    if (etag) response.headers.set("ETag", etag);
    return response;
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const ifMatch = request.headers.get("if-match");
  if (!ifMatch) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "An If-Match header is required to update a profile.",
          field: null,
          details: null,
          request_id: null,
          retry_after: null,
        },
      },
      { status: 400 },
    );
  }

  const parsed = profileValidation.profileUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const { data, headers } = await apiFetchWithHeaders<FullProfileResponse>("/profiles/me", {
      method: "PATCH",
      accessToken: session.accessToken,
      headers: { "If-Match": ifMatch },
      body: parsed.data,
    });
    const response = NextResponse.json(data);
    const etag = headers.get("etag");
    if (etag) response.headers.set("ETag", etag);
    return response;
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
