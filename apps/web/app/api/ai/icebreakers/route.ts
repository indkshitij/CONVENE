import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, apiFetch, type IcebreakersResult } from "@/lib/api/client";
import { requireSession } from "@/lib/auth/guards";

const bodySchema = z.object({ candidate_id: z.string().min(1) }).strict();

// PRD §17.9 endpoint 55, §12.5. §12.1's "fail open on features" applies
// here at the BFF layer too: quota/abuse/model-unavailable errors, and
// even a request body Next.js failed to parse (this route is called
// from a background query that can race the composer's own unmount on
// navigation), are all mapped to the same honest `{status:"unavailable"}`
// shape the caller already knows how to fall back from, rather than
// surfacing a hard error for what's meant to be a nice-to-have
// suggestion.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const rawBody = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success)
    return NextResponse.json({ status: "unavailable" } satisfies IcebreakersResult);

  try {
    const data = await apiFetch<IcebreakersResult>("/ai/icebreakers", {
      method: "POST",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError)
      return NextResponse.json({ status: "unavailable" } satisfies IcebreakersResult);
    throw err;
  }
}
