import { NextResponse } from "next/server";
import { ApiError, apiFetch, type CompletionResult } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// apps/api's GET /profiles/me/completion (completion.service.ts) — the
// missing-items breakdown behind design.md §14.15's "Next: add 2 more
// skills (+6%)" line. Self-only, real server-computed logic — never
// reimplemented client-side (CLAUDE.md rule 6).
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<CompletionResult>("/profiles/me/completion", {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
