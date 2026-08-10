import { location as locationValidation } from "@convene/validation";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch, type LocationUpdateResponse } from "@/lib/api/client";
import { apiErrorResponse, validationErrorResponse } from "@/lib/api/bff-error-response";
import { requireSession } from "@/lib/auth/guards";

// PRD §10.5.7: `PUT /location { source, latitude, longitude, accuracy_m }`
// — precise (GPS) location. apps/api's own response never echoes
// coordinates back (LocationUpdateResponse has no such field); this route
// forwards that response as-is rather than re-shaping it, since it's
// already coordinate-free at the source.
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  const parsed = locationValidation.preciseLocationSchema.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await apiFetch<LocationUpdateResponse>("/location", {
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
