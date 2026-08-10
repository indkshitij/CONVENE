import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guards";
import { fetchProfileById } from "@/lib/profile/fetch-profile";

// P24.1's own acceptance criterion: "403-private and 404-not-found
// render identical copy." apps/api's GET /profiles/:userId already
// collapses a nonexistent id and a private/insufficient-visibility
// profile into the same 404 PROFILE_NOT_FOUND (profile.service.ts's own
// comment: "a private profile and a nonexistent id must be
// indistinguishable"). The one real gap is BLOCKED, which apps/api
// returns as a distinguishable 403 — this BFF route collapses that into
// the same generic 404 shape too, so nothing this app ever serves to the
// browser can leak "you're blocked" vs "this doesn't exist" vs "this is
// private". The client never sees the real status/code for any of the
// three.
const GENERIC_UNAVAILABLE = {
  error: {
    code: "PROFILE_NOT_FOUND",
    message: "This profile isn't available",
    field: null,
    details: null,
    request_id: null,
    retry_after: null,
  },
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { userId } = await context.params;

  const data = await fetchProfileById(session.accessToken, userId);
  if (!data) return NextResponse.json(GENERIC_UNAVAILABLE, { status: 404 });
  return NextResponse.json(data);
}
