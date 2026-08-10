import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { requireSession } from "@/lib/auth/guards";

const bodySchema = z.object({ ai_drafted: z.boolean() }).strict();

// §12.5's "> 60% AI-drafted first messages" guardrail — the composer
// reports the one signal apps/api's gateway can't observe itself
// (whether the sender used an AI-drafted opener), fire-and-forget.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  // Fire-and-forget from the composer, sent right as the page may be
  // navigating away on send-success — the body can arrive truncated if
  // the browser cancels the request mid-flight. That's fine for a
  // best-effort metric; failing to parse it just skips this one
  // datapoint rather than logging an unhandled parse exception.
  const rawBody = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  await apiFetch("/ai/first-message-metric", {
    method: "POST",
    accessToken: session.accessToken,
    body: parsed.data,
  }).catch(() => undefined);
  return new NextResponse(null, { status: 204 });
}
