import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../common/clock";
import { LocationService } from "./location.service";

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
];

const TEST_ENCRYPTION_KEY = "test-only-location-encryption-key-32chars-min";

// P9.1's own testing requirements: "Assert the response body has no
// coordinate fields. Assert a stored coordinate is unreadable without the
// encryption key." Run against a real Postgres with real pgcrypto and
// PostGIS (see otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("LocationService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: LocationService;
  let now: Date;
  const clock: Clock = { now: () => now };

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

    // A small real geo fixture — Bengaluru and Mumbai, so reverse-geocode
    // has something real to resolve to.
    await sql`INSERT INTO countries (code, name) VALUES ('IN', 'India') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO states (country_code, name) VALUES ('IN', 'Karnataka'), ('IN', 'Maharashtra') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO cities (state_id, country_code, name, timezone, centroid)
      VALUES
        ((SELECT id FROM states WHERE name = 'Karnataka'), 'IN', 'Bengaluru', 'Asia/Kolkata', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography),
        ((SELECT id FROM states WHERE name = 'Maharashtra'), 'IN', 'Mumbai', 'Asia/Kolkata', ST_SetSRID(ST_MakePoint(72.8777, 19.0760), 4326)::geography)
    `;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await sql`DELETE FROM users`;
    now = new Date("2026-08-08T00:00:00Z");
    const postgresService = { db } as never;
    const env = { LOCATION_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY } as never;
    service = new LocationService(postgresService, env, clock);
  });

  async function createUser(): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"loc-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Loc Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id) VALUES (${userId})`;
    return userId;
  }

  it("resolves the nearest city, timezone, and geohash from GPS coordinates", async () => {
    const userId = await createUser();
    const result = await service.updatePreciseLocation(userId, {
      source: "gps",
      latitude: 12.972,
      longitude: 77.595,
      accuracy_m: 15,
    });

    expect(result.city?.name).toBe("Bengaluru");
    expect(result.timezone).toBe("Asia/Kolkata");
    expect(result.geohash_5).toHaveLength(5);
    expect(Object.keys(result)).not.toContain("latitude");
    expect(Object.keys(result)).not.toContain("longitude");
    expect(Object.keys(result)).not.toContain("coordinates");
  });

  it("stores a coordinate that is unreadable without the correct pgcrypto key, and readable with it", async () => {
    const userId = await createUser();
    await service.updatePreciseLocation(userId, {
      source: "gps",
      latitude: 12.972,
      longitude: 77.595,
      accuracy_m: 15,
    });

    const [row] =
      await sql`SELECT coordinates_encrypted, ST_AsText(coordinates) AS plain_wkt FROM profiles WHERE user_id = ${userId}`;
    const encrypted = (row as { coordinates_encrypted: Buffer }).coordinates_encrypted;
    expect(encrypted).toBeInstanceOf(Buffer);
    // The ciphertext must not contain the plaintext coordinate digits.
    expect(encrypted.toString("latin1")).not.toContain("77.595");
    expect(encrypted.toString("latin1")).not.toContain("12.972");

    await expect(
      sql`SELECT pgp_sym_decrypt(${encrypted}, 'wrong-key') AS decrypted`,
    ).rejects.toThrow();

    const [decryptedRow] =
      await sql`SELECT pgp_sym_decrypt(${encrypted}, ${TEST_ENCRYPTION_KEY}) AS decrypted`;
    expect((decryptedRow as { decrypted: string }).decrypted).toBe("POINT(77.595 12.972)");
  });

  it("BR-LOC-04: rejects a second GPS update within 15 minutes with 429 LOCATION_UPDATE_TOO_FREQUENT", async () => {
    const userId = await createUser();
    await service.updatePreciseLocation(userId, {
      source: "gps",
      latitude: 12.972,
      longitude: 77.595,
      accuracy_m: 15,
    });

    now = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes later
    await expect(
      service.updatePreciseLocation(userId, {
        source: "gps",
        latitude: 12.98,
        longitude: 77.6,
        accuracy_m: 15,
      }),
    ).rejects.toMatchObject({ code: "LOCATION_UPDATE_TOO_FREQUENT", httpStatus: 429 });
  });

  it("BR-LOC-04: allows a GPS update after the 15-minute cooldown", async () => {
    const userId = await createUser();
    await service.updatePreciseLocation(userId, {
      source: "gps",
      latitude: 12.972,
      longitude: 77.595,
      accuracy_m: 15,
    });

    now = new Date(now.getTime() + 16 * 60 * 1000);
    await expect(
      service.updatePreciseLocation(userId, {
        source: "gps",
        latitude: 12.98,
        longitude: 77.6,
        accuracy_m: 15,
      }),
    ).resolves.toMatchObject({ city: { name: "Bengaluru" } });
  });

  it("BR-LOC-01: manual city selection never stores coordinates", async () => {
    const userId = await createUser();
    const [city] = await sql`SELECT id FROM cities WHERE name = 'Mumbai'`;
    const cityId = (city as { id: number }).id;

    const result = await service.updateManualLocation(userId, { city_id: cityId });
    expect(result.city?.name).toBe("Mumbai");
    expect(result.geohash_5).toBeNull();

    const [row] =
      await sql`SELECT coordinates, coordinates_encrypted, location_source FROM profiles WHERE user_id = ${userId}`;
    expect((row as { coordinates: unknown }).coordinates).toBeNull();
    expect((row as { coordinates_encrypted: unknown }).coordinates_encrypted).toBeNull();
    expect((row as { location_source: string }).location_source).toBe("manual");
  });

  it("manual location updates are never subject to the GPS 15-minute throttle", async () => {
    const userId = await createUser();
    await service.updatePreciseLocation(userId, {
      source: "gps",
      latitude: 12.972,
      longitude: 77.595,
      accuracy_m: 15,
    });

    const [city] = await sql`SELECT id FROM cities WHERE name = 'Mumbai'`;
    now = new Date(now.getTime() + 60 * 1000); // 1 minute later — would fail if throttled like GPS
    await expect(
      service.updateManualLocation(userId, { city_id: (city as { id: number }).id }),
    ).resolves.toMatchObject({
      city: { name: "Mumbai" },
    });
  });

  it("updatePrivacy stores the chosen privacy level", async () => {
    const userId = await createUser();
    const result = await service.updatePrivacy(userId, { location_privacy: "hidden" });
    expect(result).toEqual({ location_privacy: "hidden" });

    const [row] = await sql`SELECT location_privacy FROM profiles WHERE user_id = ${userId}`;
    expect((row as { location_privacy: string }).location_privacy).toBe("hidden");
  });

  it("BR-LOC-06: rejects a non-preset radius on the free plan but allows it on a paid plan", async () => {
    const userId = await createUser();
    await expect(
      service.updatePreferences(userId, "free", {
        search_radius_km: 37,
        remote_preference: "any",
        open_to_relocate: false,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await expect(
      service.updatePreferences(userId, "premium", {
        search_radius_km: 37,
        remote_preference: "any",
        open_to_relocate: false,
      }),
    ).resolves.toMatchObject({ search_radius_km: 37 });
  });

  it("updatePreferences stores relocation targets and pinned_tier", async () => {
    const userId = await createUser();
    const [bengaluru] = await sql`SELECT id FROM cities WHERE name = 'Bengaluru'`;
    const cityId = (bengaluru as { id: number }).id;

    const result = await service.updatePreferences(userId, "pro", {
      search_radius_km: 500,
      remote_preference: "remote",
      open_to_relocate: true,
      relocate_target_city_ids: [cityId],
      auto_expand_radius: false,
      pinned_tier: 3,
    });

    expect(result).toEqual({
      search_radius_km: 500,
      remote_preference: "remote",
      open_to_relocate: true,
      relocate_target_city_ids: [cityId],
      auto_expand_radius: false,
      pinned_tier: 3,
    });
  });

  it("nearby_user_count is a real count, not a fabricated number", async () => {
    const userId = await createUser();
    const other = await createUser();
    await service.updatePreciseLocation(other, {
      source: "gps",
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy_m: 15,
    });

    now = new Date(now.getTime() + 20 * 60 * 1000);
    const result = await service.updatePreciseLocation(userId, {
      source: "gps",
      latitude: 12.972,
      longitude: 77.595,
      accuracy_m: 15,
    });
    expect(result.nearby_user_count).toBe(1);
  });
});
