import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface CandidateRow {
  userId: string;
  distanceM: number | null;
}

export interface ViewerLocationContext {
  viewerId: string;
  latitude: number | null;
  longitude: number | null;
  cityId: number | null;
  stateId: number | null;
  countryCode: string | null;
  timezone: string | null;
}

const STAGE_LIMIT = 500; // RE-2: "No stage scans more than LIMIT 500."

// PRD §10.5.5/§10.5.6: the six-stage radius-expansion candidate queries.
// Stage 0/1 mirror §10.5.6's own SQL almost verbatim (ST_DWithin
// filtering + KNN `<->` ordering, both GIST-index-assisted, joined to
// availability_live for the "available now" filter). Stages 2-5 aren't
// given literal SQL in the PRD (only described in the flowchart) — each
// still reuses the same common filters and the LIMIT 500 / cheap-query
// discipline RE-2 requires, ordered by whatever signal actually
// distinguishes candidates at that tier (KNN distance for 0/1,
// profile_completion for city/state/country, timezone-band match then
// completion for global).
@Injectable()
export class CandidateRepository {
  constructor(private readonly postgres: PostgresService) {}

  // Stage 0: ST_DWithin(R) + available_now.
  async stage0(ctx: ViewerLocationContext, radiusM: number): Promise<CandidateRow[]> {
    if (ctx.latitude === null || ctx.longitude === null) return [];
    const rows = await this.postgres.db.execute<{ user_id: string; distance_m: number }>(sql`
      SELECT p.user_id,
             ST_Distance(p.coordinates, ST_SetSRID(ST_MakePoint(${ctx.longitude}, ${ctx.latitude}), 4326)::geography) AS distance_m
      FROM profiles p
      JOIN availability_live al ON al.user_id = p.user_id
      WHERE p.coordinates IS NOT NULL
        AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint(${ctx.longitude}, ${ctx.latitude}), 4326)::geography, ${radiusM})
        AND al.state = 'available_now'
        AND p.user_id <> ${ctx.viewerId}
        AND p.profile_visibility IN ('public','authenticated')
        AND p.location_privacy <> 'hidden'
        AND p.profile_completion >= 40
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${ctx.viewerId} AND b.blocked_id = p.user_id)
             OR (b.blocker_id = p.user_id AND b.blocked_id = ${ctx.viewerId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM match_suppressions s
          WHERE s.user_id = ${ctx.viewerId} AND s.suppressed_id = p.user_id AND s.expires_at > now()
        )
      ORDER BY p.coordinates <-> ST_SetSRID(ST_MakePoint(${ctx.longitude}, ${ctx.latitude}), 4326)::geography
      LIMIT ${STAGE_LIMIT}
    `);
    return rows.map((r) => ({ userId: r.user_id, distanceM: r.distance_m }));
  }

  // Stage 1: ST_DWithin(R x 2), capped at 100km, still available_now.
  async stage1(ctx: ViewerLocationContext, radiusM: number): Promise<CandidateRow[]> {
    const expandedRadiusM = Math.min(radiusM * 2, 100_000);
    return this.stage0(ctx, expandedRadiusM);
  }

  // Stage 2: same city_id, availability filter dropped (busy/scheduled/offline included).
  async stage2(ctx: ViewerLocationContext): Promise<CandidateRow[]> {
    if (ctx.cityId === null) return [];
    const rows = await this.postgres.db.execute<{ user_id: string }>(sql`
      SELECT p.user_id
      FROM profiles p
      WHERE p.city_id = ${ctx.cityId}
        AND p.user_id <> ${ctx.viewerId}
        AND p.profile_visibility IN ('public','authenticated')
        AND p.location_privacy <> 'hidden'
        AND p.profile_completion >= 40
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${ctx.viewerId} AND b.blocked_id = p.user_id)
             OR (b.blocker_id = p.user_id AND b.blocked_id = ${ctx.viewerId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM match_suppressions s
          WHERE s.user_id = ${ctx.viewerId} AND s.suppressed_id = p.user_id AND s.expires_at > now()
        )
      ORDER BY p.profile_completion DESC
      LIMIT ${STAGE_LIMIT}
    `);
    return rows.map((r) => ({ userId: r.user_id, distanceM: null }));
  }

  // Stage 3: same state_id, reached via a join through cities (no direct
  // state column on profiles — only country_code was denormalized,
  // per idx_profiles_country_tz being the only state/country-tier index
  // the PRD names explicitly).
  async stage3(ctx: ViewerLocationContext): Promise<CandidateRow[]> {
    if (ctx.stateId === null) return [];
    const rows = await this.postgres.db.execute<{ user_id: string }>(sql`
      SELECT p.user_id
      FROM profiles p
      JOIN cities c ON c.id = p.city_id
      WHERE c.state_id = ${ctx.stateId}
        AND p.user_id <> ${ctx.viewerId}
        AND p.profile_visibility IN ('public','authenticated')
        AND p.location_privacy <> 'hidden'
        AND p.profile_completion >= 40
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${ctx.viewerId} AND b.blocked_id = p.user_id)
             OR (b.blocker_id = p.user_id AND b.blocked_id = ${ctx.viewerId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM match_suppressions s
          WHERE s.user_id = ${ctx.viewerId} AND s.suppressed_id = p.user_id AND s.expires_at > now()
        )
      ORDER BY p.profile_completion DESC
      LIMIT ${STAGE_LIMIT}
    `);
    return rows.map((r) => ({ userId: r.user_id, distanceM: null }));
  }

  // Stage 4: same country_code — uses idx_profiles_country_tz directly.
  async stage4(ctx: ViewerLocationContext): Promise<CandidateRow[]> {
    if (ctx.countryCode === null) return [];
    const rows = await this.postgres.db.execute<{ user_id: string }>(sql`
      SELECT p.user_id
      FROM profiles p
      WHERE p.country_code = ${ctx.countryCode}
        AND p.user_id <> ${ctx.viewerId}
        AND p.profile_visibility IN ('public','authenticated')
        AND p.location_privacy <> 'hidden'
        AND p.profile_completion >= 40
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${ctx.viewerId} AND b.blocked_id = p.user_id)
             OR (b.blocker_id = p.user_id AND b.blocked_id = ${ctx.viewerId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM match_suppressions s
          WHERE s.user_id = ${ctx.viewerId} AND s.suppressed_id = p.user_id AND s.expires_at > now()
        )
      ORDER BY p.profile_completion DESC
      LIMIT ${STAGE_LIMIT}
    `);
    return rows.map((r) => ({ userId: r.user_id, distanceM: null }));
  }

  // Stage 5: global, timezone-band ordered. A same-timezone candidate is
  // ordered first as an approximation of "timezone-band ordered" — a real
  // UTC-offset distance calc would need per-zone offset data this schema
  // doesn't model (timezone is stored as an IANA string, not a numeric
  // offset), flagged as a simplification.
  async stage5(ctx: ViewerLocationContext): Promise<CandidateRow[]> {
    const rows = await this.postgres.db.execute<{ user_id: string }>(sql`
      SELECT p.user_id
      FROM profiles p
      WHERE p.user_id <> ${ctx.viewerId}
        AND p.profile_visibility IN ('public','authenticated')
        AND p.location_privacy <> 'hidden'
        AND p.profile_completion >= 40
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${ctx.viewerId} AND b.blocked_id = p.user_id)
             OR (b.blocker_id = p.user_id AND b.blocked_id = ${ctx.viewerId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM match_suppressions s
          WHERE s.user_id = ${ctx.viewerId} AND s.suppressed_id = p.user_id AND s.expires_at > now()
        )
      ORDER BY (p.timezone = ${ctx.timezone}) DESC, p.profile_completion DESC
      LIMIT ${STAGE_LIMIT}
    `);
    return rows.map((r) => ({ userId: r.user_id, distanceM: null }));
  }

  // Shared by ExpansionService and AvailabilityService's match_preview —
  // coordinates are read here purely as internal SQL parameters, never
  // assigned to a TS property named `coordinates` or returned past this
  // repository (BR-LOC-02).
  async resolveViewerContext(viewerId: string): Promise<ViewerLocationContext | null> {
    const rows = await this.postgres.db.execute<{
      lat: number | null;
      lng: number | null;
      city_id: number | null;
      state_id: number | null;
      country_code: string | null;
      timezone: string | null;
    }>(sql`
      SELECT
        ST_Y(p.coordinates::geometry) AS lat,
        ST_X(p.coordinates::geometry) AS lng,
        p.city_id,
        c.state_id,
        p.country_code,
        p.timezone
      FROM profiles p
      LEFT JOIN cities c ON c.id = p.city_id
      WHERE p.user_id = ${viewerId}
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      viewerId,
      latitude: row.lat,
      longitude: row.lng,
      cityId: row.city_id,
      stateId: row.state_id,
      countryCode: row.country_code,
      timezone: row.timezone,
    };
  }

  // Anyone within radiusM regardless of availability state — used for
  // §10.3.8's `nearby_count` in match_preview, which is deliberately
  // broader than `available_now_count` (people around vs. people
  // reachable right now).
  async countWithinRadius(ctx: ViewerLocationContext, radiusM: number): Promise<number> {
    if (ctx.latitude === null || ctx.longitude === null) return 0;
    const rows = await this.postgres.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM profiles p
      WHERE p.coordinates IS NOT NULL
        AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint(${ctx.longitude}, ${ctx.latitude}), 4326)::geography, ${radiusM})
        AND p.user_id <> ${ctx.viewerId}
        AND p.profile_visibility IN ('public','authenticated')
        AND p.location_privacy <> 'hidden'
        AND p.profile_completion >= 40
    `);
    return rows[0]?.count ?? 0;
  }

  // Single-pair distance — used when scoring exactly one candidate
  // outside the batch recall path (GET /matches/{id}/explain), where
  // there's no stage0/1 CandidateRow already carrying a distanceM.
  // Without this, /explain's location component would silently fall back
  // to the coarser city/state/country tiers even for a nearby candidate,
  // disagreeing with whatever the feed itself just showed.
  async distanceBetween(ctx: ViewerLocationContext, candidateId: string): Promise<number | null> {
    if (ctx.latitude === null || ctx.longitude === null) return null;
    const rows = await this.postgres.db.execute<{ distance_m: number | null }>(sql`
      SELECT ST_Distance(p.coordinates, ST_SetSRID(ST_MakePoint(${ctx.longitude}, ${ctx.latitude}), 4326)::geography) AS distance_m
      FROM profiles p
      WHERE p.user_id = ${candidateId} AND p.coordinates IS NOT NULL
    `);
    return rows[0]?.distance_m ?? null;
  }
}
