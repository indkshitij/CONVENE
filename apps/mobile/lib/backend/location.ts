import { apiFetch } from "./client";

// PRD §10.5.7: `PUT /location { source, latitude, longitude, accuracy_m }`.
// apps/api's own response never echoes coordinates back — see
// apps/web/lib/api/client.ts's LocationUpdateResponse comment for why.
export interface LocationUpdateResponse {
  nearby_user_count: number;
}

export function updatePreciseLocation(
  accessToken: string,
  latitude: number,
  longitude: number,
): Promise<LocationUpdateResponse> {
  return apiFetch<LocationUpdateResponse>("/location", {
    method: "PUT",
    accessToken,
    body: { source: "gps", latitude, longitude, accuracy_m: 50 },
  });
}
