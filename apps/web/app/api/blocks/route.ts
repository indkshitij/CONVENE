import { connections as connectionsValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type BlockedUser } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// design.md §14.18's Safety section: the blocked-users list.
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<{ blocks: BlockedUser[] }>("/blocks", {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}

// PRD §17.9 endpoint 36: `POST /blocks` — design.md §14.14's profile ⋯
// menu "Block" action.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = connectionsValidation.createBlockSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch("/blocks", {
      method: "POST",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
