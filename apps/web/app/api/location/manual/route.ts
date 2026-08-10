import { location as locationValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type LocationUpdateResponse } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.5.7: `PUT /location/manual { city_id }` — the GPS-denial
// fallback (BR-LOC-01), a first-class path, not degraded behaviour.
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = locationValidation.manualLocationSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<LocationUpdateResponse>("/location/manual", {
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
