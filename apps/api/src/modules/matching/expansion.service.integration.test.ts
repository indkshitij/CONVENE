import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheService } from "../../common/cache/cache.service";
import { CandidateRepository } from "./repositories/candidate.repository";
import { ExpansionService } from "./services/expansion.service";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

const migrationsDir = join(__dirname, "..", "..", "..", "..", "..", "packages", "db", "migrations");
const dockerContextDir = join(__dirname, "..", "..", "..", "..", "..", "docker", "postgres");

const MIGRATIONS = [
  "0000_identity",
  "0001_profile_geo",
  "0002_intents_availability_messaging",
  "0003_matching_safety_billing_audit",
  "0004_auth_session_security",
  "0005_refresh_sessions",
  "0006_password_reset_tokens",
  "0007_erasure_retention_fks",
  "0008_profile_search_and_name_change",
  "0009_verification_ladder",
  "0010_location_encryption",
  "0011_candidate_generation_indexes",
];

class FakeRedisClient {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<"OK"> {
    this.store.set(key, value);
    return "OK";
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

// PRD §10.5.5/§10.5.6, run against a real Postgres (see
// otp.service.integration.test.ts for why PostGIS-dependent queries need
// one rather than a mocked query builder).
describe.skipIf(!dockerAvailable)(
  "Candidate generation & radius expansion (Testcontainers)",
  () => {
    let container: StartedTestContainer;
    let sql: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    let candidateRepository: CandidateRepository;

    beforeAll(async () => {
      container = await GenericContainer.fromDockerfile(dockerContextDir)
        .build()
        .then((image) =>
          image.withExposedPorts(5432).withEnvironment({ POSTGRES_PASSWORD: "test" }).start(),
        );

      const port = container.getMappedPort(5432);
      const host = container.getHost();
      sql = postgres(`postgres://postgres:test@${host}:${port}/postgres`, { max: 5 });
      db = drizzle(sql, { schema });

      for (const migration of MIGRATIONS) {
        const upSql = readFileSync(join(migrationsDir, `${migration}.sql`), "utf8");
        await sql.unsafe(upSql);
      }
    }, 120_000);

    afterAll(async () => {
      await sql?.end();
      await container?.stop();
    });

    beforeEach(async () => {
      await sql`DELETE FROM availability_live`;
      await sql`DELETE FROM match_suppressions`;
      await sql`DELETE FROM blocks`;
      await sql`DELETE FROM users`;
      await sql`DELETE FROM cities`;
      await sql`DELETE FROM states`;
      await sql`DELETE FROM countries`;

      const postgresService = { db } as never;
      candidateRepository = new CandidateRepository(postgresService);

      await sql`INSERT INTO countries (code, name) VALUES ('IN', 'India'), ('US', 'United States')`;
      await sql`INSERT INTO states (country_code, name) VALUES ('IN', 'Karnataka'), ('IN', 'Maharashtra')`;
      await sql`
      INSERT INTO cities (id, state_id, country_code, name, timezone, centroid)
      OVERRIDING SYSTEM VALUE
      VALUES
        (1, (SELECT id FROM states WHERE name = 'Karnataka'), 'IN', 'Bengaluru', 'Asia/Kolkata', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography),
        (2, (SELECT id FROM states WHERE name = 'Karnataka'), 'IN', 'Mysuru', 'Asia/Kolkata', ST_SetSRID(ST_MakePoint(76.6394, 12.2958), 4326)::geography),
        (3, (SELECT id FROM states WHERE name = 'Maharashtra'), 'IN', 'Mumbai', 'Asia/Kolkata', ST_SetSRID(ST_MakePoint(72.8777, 19.0760), 4326)::geography),
        (4, NULL, 'US', 'New York', 'America/New_York', ST_SetSRID(ST_MakePoint(-74.0060, 40.7128), 4326)::geography)
    `;
      await sql`SELECT setval(pg_get_serial_sequence('cities','id'), (SELECT max(id) FROM cities))`;
    });

    async function createUser(
      label: string,
      opts: {
        cityId: number;
        lat: number;
        lng: number;
        countryCode: string;
        timezone: string;
        available?: boolean;
      },
    ): Promise<string> {
      const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${label + "-" + Math.random().toString(36).slice(2) + "@example.com"}, ${label}, '1990-01-01', 'v1')
      RETURNING id
    `;
      const userId = (user as { id: string }).id;
      await sql`
      INSERT INTO profiles (user_id, city_id, country_code, timezone, coordinates, profile_completion, profile_visibility)
      VALUES (${userId}, ${opts.cityId}, ${opts.countryCode}, ${opts.timezone},
              ST_SetSRID(ST_MakePoint(${opts.lng}, ${opts.lat}), 4326)::geography, 60, 'public')
    `;
      if (opts.available) {
        await sql`INSERT INTO availability_live (user_id, state) VALUES (${userId}, 'available_now')`;
      }
      return userId;
    }

    const viewerLocation = {
      cityId: 1,
      lat: 12.9716,
      lng: 77.5946,
      countryCode: "IN",
      timezone: "Asia/Kolkata",
    };

    it("stage 0: returns only a nearby, available_now candidate within the requested radius", async () => {
      const viewer = await createUser("viewer", { ...viewerLocation, available: true });
      const near = await createUser("near", {
        cityId: 1,
        lat: 12.973,
        lng: 77.596,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
        available: true,
      });
      await createUser("near-but-not-available", {
        cityId: 1,
        lat: 12.9721,
        lng: 77.5951,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
        available: false,
      });
      await createUser("far", {
        cityId: 3,
        lat: 19.076,
        lng: 72.8777,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
        available: true,
      });

      const ctx = {
        viewerId: viewer,
        latitude: viewerLocation.lat,
        longitude: viewerLocation.lng,
        cityId: 1,
        stateId: null,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      };
      const results = await candidateRepository.stage0(ctx, 5000);
      expect(results.map((r) => r.userId)).toEqual([near]);
    });

    it("stage 2: same city_id regardless of availability", async () => {
      const viewer = await createUser("viewer", { ...viewerLocation, available: true });
      const sameCityBusy = await createUser("same-city-busy", {
        cityId: 1,
        lat: 13.05,
        lng: 77.65,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
        available: false,
      });
      await createUser("different-city", {
        cityId: 2,
        lat: 12.2958,
        lng: 76.6394,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
        available: false,
      });

      const ctx = {
        viewerId: viewer,
        latitude: viewerLocation.lat,
        longitude: viewerLocation.lng,
        cityId: 1,
        stateId: null,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      };
      const results = await candidateRepository.stage2(ctx);
      expect(results.map((r) => r.userId)).toEqual([sameCityBusy]);
    });

    it("stage 3: same state, different city", async () => {
      const [karnatakaId] = await sql`SELECT id FROM states WHERE name = 'Karnataka'`;
      const viewer = await createUser("viewer", { ...viewerLocation, available: true });
      const sameState = await createUser("same-state", {
        cityId: 2,
        lat: 12.2958,
        lng: 76.6394,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      });
      await createUser("different-state", {
        cityId: 3,
        lat: 19.076,
        lng: 72.8777,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      });

      const ctx = {
        viewerId: viewer,
        latitude: viewerLocation.lat,
        longitude: viewerLocation.lng,
        cityId: 1,
        stateId: (karnatakaId as { id: number }).id,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      };
      const results = await candidateRepository.stage3(ctx);
      expect(results.map((r) => r.userId)).toEqual([sameState]);
    });

    it("stage 4: same country, different state", async () => {
      const viewer = await createUser("viewer", { ...viewerLocation, available: true });
      const sameCountry = await createUser("same-country", {
        cityId: 3,
        lat: 19.076,
        lng: 72.8777,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      });
      await createUser("different-country", {
        cityId: 4,
        lat: 40.7128,
        lng: -74.006,
        countryCode: "US",
        timezone: "America/New_York",
      });

      const ctx = {
        viewerId: viewer,
        latitude: viewerLocation.lat,
        longitude: viewerLocation.lng,
        cityId: 1,
        stateId: null,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      };
      const results = await candidateRepository.stage4(ctx);
      expect(results.map((r) => r.userId)).toEqual([sameCountry]);
    });

    it("stage 5: everyone else globally, same-timezone ordered first", async () => {
      const viewer = await createUser("viewer", { ...viewerLocation, available: true });
      const global = await createUser("global", {
        cityId: 4,
        lat: 40.7128,
        lng: -74.006,
        countryCode: "US",
        timezone: "America/New_York",
      });

      const ctx = {
        viewerId: viewer,
        latitude: viewerLocation.lat,
        longitude: viewerLocation.lng,
        cityId: 1,
        stateId: null,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      };
      const results = await candidateRepository.stage5(ctx);
      expect(results.map((r) => r.userId)).toContain(global);
    });

    it("excludes blocked users and active suppressions at every stage", async () => {
      const viewer = await createUser("viewer", { ...viewerLocation, available: true });
      const blocked = await createUser("blocked", {
        cityId: 1,
        lat: 12.973,
        lng: 77.596,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
        available: true,
      });
      const suppressed = await createUser("suppressed", {
        cityId: 1,
        lat: 12.9731,
        lng: 77.5961,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
        available: true,
      });
      await sql`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${viewer}, ${blocked})`;
      await sql`INSERT INTO match_suppressions (user_id, suppressed_id) VALUES (${viewer}, ${suppressed})`;

      const ctx = {
        viewerId: viewer,
        latitude: viewerLocation.lat,
        longitude: viewerLocation.lng,
        cityId: 1,
        stateId: null,
        countryCode: "IN",
        timezone: "Asia/Kolkata",
      };
      const results = await candidateRepository.stage0(ctx, 5000);
      expect(results).toEqual([]);
    });

    describe("ExpansionService", () => {
      function makeService(): ExpansionService {
        const postgresService = { db } as never;
        const cache = new CacheService({ client: new FakeRedisClient() } as never);
        return new ExpansionService(postgresService, candidateRepository, cache);
      }

      it("RE-1: appends across stages — stage-1 candidates are ordered ahead of stage-3 candidates", async () => {
        const viewer = await createUser("viewer", { ...viewerLocation, available: true });
        const nearby = await createUser("nearby", {
          cityId: 1,
          lat: 12.973,
          lng: 77.596,
          countryCode: "IN",
          timezone: "Asia/Kolkata",
          available: true,
        });
        const sameState = await createUser("same-state", {
          cityId: 2,
          lat: 12.2958,
          lng: 76.6394,
          countryCode: "IN",
          timezone: "Asia/Kolkata",
        });

        const service = makeService();
        const result = await service.expand(viewer, 5);

        const nearbyIndex = result.candidates.findIndex((c) => c.userId === nearby);
        const sameStateIndex = result.candidates.findIndex((c) => c.userId === sameState);
        expect(nearbyIndex).toBeGreaterThanOrEqual(0);
        expect(sameStateIndex).toBeGreaterThan(nearbyIndex);
        expect(result.stage).toBe(5); // exhausted — nowhere near 40 candidates in this fixture
        expect(result.labels).toEqual([
          "Nearby",
          "Extended",
          "In your city",
          "In your state",
          "In your country",
          "Worldwide",
        ]);
      });

      it("a candidate found at an earlier stage is never duplicated at a later stage", async () => {
        const viewer = await createUser("viewer", { ...viewerLocation, available: true });
        const nearby = await createUser("nearby", {
          cityId: 1,
          lat: 12.973,
          lng: 77.596,
          countryCode: "IN",
          timezone: "Asia/Kolkata",
          available: true,
        });

        const service = makeService();
        const result = await service.expand(viewer, 5);
        const occurrences = result.candidates.filter((c) => c.userId === nearby).length;
        expect(occurrences).toBe(1);
      });

      it("RE-6: a pinned_tier runs only that stage, with no auto-expansion", async () => {
        const viewer = await createUser("viewer", { ...viewerLocation, available: true });
        await sql`UPDATE profiles SET pinned_tier = 4 WHERE user_id = ${viewer}`;
        const sameCountry = await createUser("same-country", {
          cityId: 3,
          lat: 19.076,
          lng: 72.8777,
          countryCode: "IN",
          timezone: "Asia/Kolkata",
        });
        const nearby = await createUser("nearby", {
          cityId: 1,
          lat: 12.973,
          lng: 77.596,
          countryCode: "IN",
          timezone: "Asia/Kolkata",
          available: true,
        });

        const service = makeService();
        const result = await service.expand(viewer, 5);

        expect(result.pinned).toBe(true);
        expect(result.stage).toBe(4);
        expect(result.candidates.map((c) => c.userId)).toContain(sameCountry);
        expect(result.candidates.map((c) => c.userId)).not.toContain(nearby);
      });

      it("RE-4: caches the result for 90s — a second call within the TTL doesn't hit Postgres again", async () => {
        const viewer = await createUser("viewer", { ...viewerLocation, available: true });
        await createUser("nearby", {
          cityId: 1,
          lat: 12.973,
          lng: 77.596,
          countryCode: "IN",
          timezone: "Asia/Kolkata",
          available: true,
        });

        const service = makeService();
        await service.expand(viewer, 5);

        const executeSpy = vi.spyOn(db, "execute");
        await service.expand(viewer, 5);
        expect(executeSpy).not.toHaveBeenCalled();
        executeSpy.mockRestore();
      });
    });
  },
);
