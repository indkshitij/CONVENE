import { intents as intentsValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type InboundFiltersResponse } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.4.6: `GET/PUT /settings/inbound-intent-filters` — design.md
// §14.18's "Intents & inbound filters" settings section.
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  try {
    const data = await apiFetch<InboundFiltersResponse>("/settings/inbound-intent-filters", {
      accessToken: session.accessToken,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = intentsValidation.inboundIntentFiltersSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<InboundFiltersResponse>("/settings/inbound-intent-filters", {
      method: "PUT",
      accessToken: session.accessToken,
      body: parsed.data,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    throw err;
  }
}
