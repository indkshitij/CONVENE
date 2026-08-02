import { describe, expect, it } from "vitest";
import {
  LATITUDE_ERROR,
  LOCATION_PRIVACY_ERROR,
  LONGITUDE_ERROR,
  REMOTE_PREFERENCE_ERROR,
  SEARCH_RADIUS_ERROR,
  locationPreferencesSchema,
  locationPrivacySchema,
  preciseLocationSchema,
  remotePreferenceSchema,
  searchRadiusKmSchema,
} from "./location";

describe("preciseLocationSchema", () => {
  it("accepts the PRD §10.5.7 worked example", () => {
    const result = preciseLocationSchema.safeParse({
      source: "gps",
      latitude: 23.1815,
      longitude: 79.9864,
      accuracy_m: 18,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range latitude", () => {
    const result = preciseLocationSchema.safeParse({
      source: "gps",
      latitude: 91,
      longitude: 79.9864,
      accuracy_m: 18,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(LATITUDE_ERROR);
  });

  it("rejects an out-of-range longitude", () => {
    const result = preciseLocationSchema.safeParse({
      source: "gps",
      latitude: 23.1815,
      longitude: 200,
      accuracy_m: 18,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(LONGITUDE_ERROR);
  });
});

describe("locationPrivacySchema", () => {
  it("accepts each of the 4 documented privacy levels", () => {
    for (const level of ["exact", "city_only", "country_only", "hidden"]) {
      expect(locationPrivacySchema.safeParse(level).success).toBe(true);
    }
  });

  it("rejects an unknown privacy level", () => {
    const result = locationPrivacySchema.safeParse("friends_only");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(LOCATION_PRIVACY_ERROR);
  });
});

describe("remotePreferenceSchema", () => {
  it("accepts each of the 4 documented preferences", () => {
    for (const pref of ["onsite", "hybrid", "remote", "any"]) {
      expect(remotePreferenceSchema.safeParse(pref).success).toBe(true);
    }
  });

  it("rejects an unknown preference", () => {
    const result = remotePreferenceSchema.safeParse("nomadic");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(REMOTE_PREFERENCE_ERROR);
  });
});

describe("searchRadiusKmSchema", () => {
  it("accepts a free-plan preset", () => {
    expect(searchRadiusKmSchema(false).safeParse(25).success).toBe(true);
  });

  it("rejects a non-preset radius on the free plan", () => {
    const result = searchRadiusKmSchema(false).safeParse(30);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SEARCH_RADIUS_ERROR);
  });

  it("accepts any radius 1-500 on the premium plan", () => {
    expect(searchRadiusKmSchema(true).safeParse(300).success).toBe(true);
  });

  it("rejects a radius over 500 even on the premium plan", () => {
    const result = searchRadiusKmSchema(true).safeParse(501);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SEARCH_RADIUS_ERROR);
  });
});

describe("locationPreferencesSchema", () => {
  it("accepts the PRD §10.5.7 worked example", () => {
    const result = locationPreferencesSchema.safeParse({
      search_radius_km: 25,
      remote_preference: "hybrid",
      open_to_relocate: true,
      relocate_target_city_ids: [3021, 1189],
      auto_expand_radius: true,
      pinned_tier: null,
    });
    expect(result.success).toBe(true);
  });
});
