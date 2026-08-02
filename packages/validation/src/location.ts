import { z } from "zod";
import { LATITUDE_ERROR, LONGITUDE_ERROR, latitudeSchema, longitudeSchema } from "./common";

// §10.5 has no dedicated "Validation Rules" table (unlike §10.1/§10.2/
// §10.3/§10.4/§10.6) — these schemas are derived from §10.5.3's business
// rules and §10.5.7's API contract shapes instead of a Validation Rules
// row, and from §10.2.2's field spec for remote_preference (shared with
// the profile domain). None of this document's tables give exact error
// copy for these fields (unlike the domains that do), so the messages
// below are plain descriptive text, not a transcription.

export { LATITUDE_ERROR, LONGITUDE_ERROR, latitudeSchema, longitudeSchema };

// PRD §10.5.7: `PUT /location { source, latitude, longitude, accuracy_m }`.
export const locationSourceSchema = z.enum(["gps", "manual", "ip"]);

export const ACCURACY_ERROR = "Enter a valid GPS accuracy";
export const accuracyMetresSchema = z.number().positive(ACCURACY_ERROR);

export const preciseLocationSchema = z.object({
  source: locationSourceSchema,
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracy_m: accuracyMetresSchema,
});

// PRD §10.5.7: `PUT /location/manual { city_id }`.
export const CITY_ID_ERROR = "Choose a city";
export const cityIdSchema = z.number().int().positive(CITY_ID_ERROR);

// PRD §10.5.3 BR-LOC-03: "Location privacy levels: exact, city_only,
// country_only, hidden."
export const LOCATION_PRIVACY_ERROR = "Choose a valid location privacy level";
export const locationPrivacySchema = z.enum(["exact", "city_only", "country_only", "hidden"], {
  message: LOCATION_PRIVACY_ERROR,
});

// PRD §10.2.2 `remote_preference` field spec (shared here since
// §10.5.7's location preferences endpoint sets it too).
export const REMOTE_PREFERENCE_ERROR = "Choose a valid remote preference";
export const remotePreferenceSchema = z.enum(["onsite", "hybrid", "remote", "any"], {
  message: REMOTE_PREFERENCE_ERROR,
});

// PRD §10.5.3 BR-LOC-06: "Search radius options: 5, 10, 25, 50, 100 km
// (free presets); Premium gets custom 1–500 km." A stateless schema can't
// know the caller's plan, so this is a factory, mirroring
// common.ts's durationMinutesSchema pattern.
export const SEARCH_RADIUS_ERROR = "Choose a valid search radius";

const FREE_RADIUS_PRESETS_KM = [5, 10, 25, 50, 100] as const;

export function searchRadiusKmSchema(isPremium: boolean) {
  if (isPremium) {
    return z.number().min(1, SEARCH_RADIUS_ERROR).max(500, SEARCH_RADIUS_ERROR);
  }
  return z
    .number()
    .refine(
      (value): value is (typeof FREE_RADIUS_PRESETS_KM)[number] =>
        (FREE_RADIUS_PRESETS_KM as readonly number[]).includes(value),
      SEARCH_RADIUS_ERROR,
    );
}

export const locationPreferencesSchema = z.object({
  search_radius_km: z.number(),
  remote_preference: remotePreferenceSchema,
  open_to_relocate: z.boolean(),
  relocate_target_city_ids: z.array(cityIdSchema).optional(),
  auto_expand_radius: z.boolean().optional(),
  pinned_tier: z.number().int().min(0).max(6).nullable().optional(),
});
