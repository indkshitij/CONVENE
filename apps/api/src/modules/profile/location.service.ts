import { cities, profiles, type NewProfile } from "@convene/db";
import { location as locationValidation } from "@convene/validation";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import {
  NotFoundAppError,
  TooManyRequestsAppError,
  ValidationAppError,
} from "../../common/errors/app-error";
import { type Clock, systemClock } from "../../common/clock";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { deriveGeohashes } from "./geohash";
import { encryptedPointSql, requireLocationEncryptionKey } from "./location-encryption";
import { PROFILE_LOCATION_CHANGED_EVENT } from "./profile-events";

export type PreciseLocationInput = z.infer<typeof locationValidation.preciseLocationSchema>;
export type ManualLocationInput = z.infer<typeof locationValidation.manualLocationSchema>;
export type LocationPrivacyInput = z.infer<typeof locationValidation.updateLocationPrivacySchema>;
export type LocationPreferencesInput = z.infer<typeof locationValidation.locationPreferencesSchema>;

export interface LocationUpdateResponse {
  city: { id: number; name: string } | null;
  state: string | null;
  country: string | null;
  timezone: string | null;
  // Included per §10.5.7's own literal response example — this is the
  // caller's own just-submitted location echoed back as a receipt, not
  // another user's data, so it doesn't implicate BR-LOC-02 (which is
  // about *exact coordinates*, never included here). §10.5.2's "Internal
  // only" marking on geohash_5 is read as governing *other* users'
  // profile responses, not this self-service confirmation — flagged as a
  // documented resolution of that tension.
  geohash_5: string | null;
  nearby_user_count: number;
}

export interface LocationPreferencesResponse {
  search_radius_km: number;
  remote_preference: string;
  open_to_relocate: boolean;
  relocate_target_city_ids: number[];
  auto_expand_radius: boolean;
  pinned_tier: number | null;
}

const LOCATION_UPDATE_COOLDOWN_MS = 15 * 60 * 1000; // BR-LOC-04
const NEARBY_COUNT_RADIUS_M = 25_000; // supply-transparency default; not a search filter

type NearestCityRow = {
  id: number;
  name: string;
  timezone: string;
  state_name: string | null;
  country_name: string | null;
  country_code: string | null;
};

// PRD §10.5.7 endpoints 26/27. §10.5.7's own four concrete routes (PUT
// /location, /location/manual, /location/privacy, /preferences/location)
// are treated as the literal shape of the master table's two collapsed
// endpoint ids, same precedent established for every other module's
// endpoint-table-vs-detailed-contract conflicts this session.
@Injectable()
export class LocationService {
  constructor(
    private readonly postgres: PostgresService,
    @Inject(ENV) private readonly env: Env,
    @Optional() private readonly clock: Clock = systemClock,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // BR-LOC-04: "GPS location is refreshed at most every 15 min." Manual
  // and IP-sourced updates aren't time-boxed the same way (a user picking
  // a different city manually isn't "refreshing GPS"), so this only
  // throttles when the incoming source is itself gps.
  async updatePreciseLocation(
    userId: string,
    input: PreciseLocationInput,
  ): Promise<LocationUpdateResponse> {
    if (input.source === "gps") {
      await this.assertNotTooFrequent(userId);
    }

    const key = requireLocationEncryptionKey(this.env.LOCATION_ENCRYPTION_KEY);
    const { geohash5, geohash3 } = deriveGeohashes(input.latitude, input.longitude);
    const nearestCity = await this.findNearestCity(input.latitude, input.longitude);
    if (!nearestCity) {
      throw new ValidationAppError(
        "GEOCODE_FAILED",
        "We couldn't determine your city — try selecting it manually.",
      );
    }

    const now = this.clock.now();
    const pointSql = sql`ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography`;

    await this.postgres.db.execute(sql`
      UPDATE profiles SET
        coordinates = ${pointSql},
        coordinates_encrypted = ${encryptedPointSql(input.latitude, input.longitude, key)},
        geohash_5 = ${geohash5},
        geohash_3 = ${geohash3},
        city_id = ${nearestCity.id},
        country_code = ${nearestCity.country_code},
        timezone = ${nearestCity.timezone},
        location_source = ${input.source},
        location_updated_at = ${now.toISOString()}
      WHERE user_id = ${userId}
    `);

    this.events?.emit(PROFILE_LOCATION_CHANGED_EVENT, { userId });

    const nearbyUserCount = await this.countNearby(userId, input.latitude, input.longitude);
    return {
      city: { id: nearestCity.id, name: nearestCity.name },
      state: nearestCity.state_name,
      country: nearestCity.country_name,
      timezone: nearestCity.timezone,
      geohash_5: geohash5,
      nearby_user_count: nearbyUserCount,
    };
  }

  // §10.5.7: `PUT /location/manual { city_id }`. BR-LOC-01: "manual city
  // selection provides full functionality at city-tier granularity" — no
  // coordinates are ever collected or stored for this path; only the
  // chosen city's own centroid/timezone are used, never the user's own
  // precise position.
  async updateManualLocation(
    userId: string,
    input: ManualLocationInput,
  ): Promise<LocationUpdateResponse> {
    const [city] = await this.postgres.db
      .select({
        id: cities.id,
        name: cities.name,
        timezone: cities.timezone,
        stateId: cities.stateId,
        countryCode: cities.countryCode,
      })
      .from(cities)
      .where(eq(cities.id, input.city_id))
      .limit(1);
    if (!city) throw new NotFoundAppError("NOT_FOUND", "That city could not be found.");

    const now = this.clock.now();
    await this.postgres.db
      .update(profiles)
      .set({
        coordinates: null,
        coordinatesEncrypted: null,
        geohash5: null,
        geohash3: null,
        cityId: city.id,
        countryCode: city.countryCode,
        timezone: city.timezone,
        locationSource: "manual",
        locationUpdatedAt: now,
      })
      .where(eq(profiles.userId, userId));

    this.events?.emit(PROFILE_LOCATION_CHANGED_EVENT, { userId });

    const [stateAndCountry] = await this.postgres.db.execute<{
      state_name: string | null;
      country_name: string | null;
    }>(sql`
      SELECT s.name AS state_name, co.name AS country_name
      FROM cities c
      LEFT JOIN states s ON s.id = c.state_id
      LEFT JOIN countries co ON co.code = c.country_code
      WHERE c.id = ${city.id}
    `);

    return {
      city: { id: city.id, name: city.name },
      state: stateAndCountry?.state_name ?? null,
      country: stateAndCountry?.country_name ?? null,
      timezone: city.timezone,
      geohash_5: null,
      nearby_user_count: await this.countNearbyByCity(userId, city.id),
    };
  }

  async updatePrivacy(
    userId: string,
    input: LocationPrivacyInput,
  ): Promise<{ location_privacy: string }> {
    await this.postgres.db
      .update(profiles)
      .set({ locationPrivacy: input.location_privacy })
      .where(eq(profiles.userId, userId));
    return { location_privacy: input.location_privacy };
  }

  // BR-LOC-06: "Search radius options: 5, 10, 25, 50, 100 km (free
  // presets); Premium gets custom 1-500 km." locationPreferencesSchema
  // itself can't know the caller's plan (stateless schema), so the actual
  // radius-tier check happens here, same pattern P8.1's plan-limit check
  // uses.
  async updatePreferences(
    userId: string,
    plan: string,
    input: LocationPreferencesInput,
  ): Promise<LocationPreferencesResponse> {
    const isPremium = plan !== "free";
    const radiusSchema = locationValidation.searchRadiusKmSchema(isPremium);
    const radiusResult = radiusSchema.safeParse(input.search_radius_km);
    if (!radiusResult.success) {
      throw new ValidationAppError("VALIDATION_FAILED", locationValidation.SEARCH_RADIUS_ERROR, {
        field: "search_radius_km",
      });
    }

    const columnUpdates: Partial<NewProfile> = {
      searchRadiusKm: input.search_radius_km,
      remotePreference: input.remote_preference,
      openToRelocate: input.open_to_relocate,
      relocateCityIds: input.relocate_target_city_ids ?? null,
      updatedAt: this.clock.now(),
    };
    if (input.auto_expand_radius !== undefined)
      columnUpdates.autoExpandRadius = input.auto_expand_radius;
    if (input.pinned_tier !== undefined) columnUpdates.pinnedTier = input.pinned_tier;

    const [updated] = await this.postgres.db
      .update(profiles)
      .set(columnUpdates)
      .where(eq(profiles.userId, userId))
      .returning();
    if (!updated) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");

    return {
      search_radius_km: updated.searchRadiusKm,
      remote_preference: updated.remotePreference,
      open_to_relocate: updated.openToRelocate,
      relocate_target_city_ids: updated.relocateCityIds ?? [],
      auto_expand_radius: updated.autoExpandRadius,
      pinned_tier: updated.pinnedTier,
    };
  }

  private async assertNotTooFrequent(userId: string): Promise<void> {
    const [profile] = await this.postgres.db
      .select({
        locationSource: profiles.locationSource,
        locationUpdatedAt: profiles.locationUpdatedAt,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile?.locationUpdatedAt || profile.locationSource !== "gps") return;

    const elapsedMs = this.clock.now().getTime() - profile.locationUpdatedAt.getTime();
    if (elapsedMs < LOCATION_UPDATE_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((LOCATION_UPDATE_COOLDOWN_MS - elapsedMs) / 1000);
      throw new TooManyRequestsAppError(
        "LOCATION_UPDATE_TOO_FREQUENT",
        "Location can only be refreshed every 15 minutes.",
        { retryAfter: retryAfterSeconds },
      );
    }
  }

  // Reverse geocode: nearest city by centroid, using the same GIST-indexed
  // KNN operator (`<->`) §10.5.6 specifies for candidate generation.
  private async findNearestCity(
    latitude: number,
    longitude: number,
  ): Promise<NearestCityRow | null> {
    const rows = await this.postgres.db.execute<NearestCityRow>(sql`
      SELECT c.id, c.name, c.timezone, s.name AS state_name, co.name AS country_name, co.code AS country_code
      FROM cities c
      LEFT JOIN states s ON s.id = c.state_id
      LEFT JOIN countries co ON co.code = c.country_code
      WHERE c.centroid IS NOT NULL
      ORDER BY c.centroid <-> ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  // Honest supply-transparency count (§10.5.7's `nearby_user_count`) — a
  // real COUNT query within a fixed radius, never a fabricated number.
  // Not the full candidate-generation pipeline (P9.3): no availability or
  // visibility filtering beyond excluding the caller and hidden profiles,
  // since that pipeline doesn't exist yet.
  private async countNearby(userId: string, latitude: number, longitude: number): Promise<number> {
    const rows = await this.postgres.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM profiles p
      WHERE p.user_id <> ${userId}
        AND p.coordinates IS NOT NULL
        AND p.location_privacy <> 'hidden'
        AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography, ${NEARBY_COUNT_RADIUS_M})
    `);
    return rows[0]?.count ?? 0;
  }

  private async countNearbyByCity(userId: string, cityId: number): Promise<number> {
    const rows = await this.postgres.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM profiles p
      WHERE p.user_id <> ${userId}
        AND p.city_id = ${cityId}
        AND p.location_privacy <> 'hidden'
    `);
    return rows[0]?.count ?? 0;
  }
}
