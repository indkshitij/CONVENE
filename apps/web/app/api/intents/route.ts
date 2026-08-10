import { intents as intentsValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type CreateIntentResult, type IntentResponse } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.4.6: GET/POST /intents act on the caller's own intents
// implicitly — no :userId segment, same pattern as /profiles/me.
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<IntentResponse[]>("/intents", { accessToken: session.accessToken });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = intentsValidation.createIntentSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<CreateIntentResult>("/intents", {
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
