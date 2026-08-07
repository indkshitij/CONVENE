import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../common/clock";
import { computeEtag } from "../../common/serialization/etag";
import { ProfileService } from "./profile.service";

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
];

// PRD §10.2 (P7.1), run against a real Postgres (see
// otp.service.integration.test.ts for why the trigger/visibility logic
// needs a real DB rather than a mocked query builder).
describe.skipIf(!dockerAvailable)("ProfileService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: ProfileService;
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
    await sql`CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs DEFAULT`;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await sql`DELETE FROM blocks`;
    await sql`DELETE FROM connections`;
    await sql`DELETE FROM audit_logs`;
    await sql`DELETE FROM users`;

    now = new Date("2026-08-03T00:00:00Z");
    const postgresService = { db } as never;
    service = new ProfileService(postgresService, clock);
  });

  async function createUser(email: string, headline = "A perfectly fine headline") {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${email}, 'Test User', '1990-01-01', 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id, headline) VALUES (${userId}, ${headline})`;
    return userId;
  }

  // P7.1's explicit testing requirement: "A private profile and a
  // nonexistent id produce byte-identical responses apart from
  // request_id." request_id is attached later by error.filter.ts, not by
  // this service — everything the service itself controls (code,
  // message, httpStatus) is asserted identical here.
  it("returns byte-identical errors for a private profile and a nonexistent id", async () => {
    const viewerId = await createUser("viewer@example.com");
    const privateUserId = await createUser("private@example.com");
    await sql`UPDATE profiles SET profile_visibility = 'private' WHERE user_id = ${privateUserId}`;
    const fakeId = "00000000-0000-7000-8000-000000000099";

    const privateError = await service
      .getProfileForViewer(viewerId, privateUserId)
      .catch((e: unknown) => e);
    const notFoundError = await service
      .getProfileForViewer(viewerId, fakeId)
      .catch((e: unknown) => e);

    const asComparable = (e: unknown) => {
      const err = e as { code: string; message: string; httpStatus: number };
      return { code: err.code, message: err.message, httpStatus: err.httpStatus };
    };
    expect(asComparable(privateError)).toEqual(asComparable(notFoundError));
    expect(asComparable(privateError)).toEqual({
      code: "PROFILE_NOT_FOUND",
      message: "This profile isn't available",
      httpStatus: 404,
    });
  });

  it("returns a distinct 403 BLOCKED for a blocked relationship", async () => {
    const viewerId = await createUser("viewer2@example.com");
    const targetId = await createUser("target2@example.com");
    await sql`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${targetId}, ${viewerId})`;

    await expect(service.getProfileForViewer(viewerId, targetId)).rejects.toMatchObject({
      code: "BLOCKED",
      httpStatus: 403,
    });
  });

  it("never includes a coordinates key anywhere in the response", async () => {
    const viewerId = await createUser("viewer3@example.com");
    const targetId = await createUser("target3@example.com");

    const response = await service.getProfileForViewer(viewerId, targetId);
    expect(JSON.stringify(response)).not.toContain("coordinates");
  });

  it("PATCH with a stale If-Match returns 409 ETAG_MISMATCH", async () => {
    const userId = await createUser("patcher@example.com");
    const current = await service.getMyProfile(userId);
    const staleEtag = computeEtag(current) + "-stale";

    await expect(
      service.updateMyProfile(userId, staleEtag, { headline: "A brand new headline here" }),
    ).rejects.toMatchObject({ code: "ETAG_MISMATCH", httpStatus: 409 });
  });

  it("a concurrent PATCH using the ETag from before a first successful PATCH also gets 409", async () => {
    const userId = await createUser("concurrent@example.com");
    const initialEtag = computeEtag(await service.getMyProfile(userId));

    await service.updateMyProfile(userId, initialEtag, {
      headline: "First writer wins this update",
    });

    // Second "concurrent" caller still holds the pre-update ETag.
    await expect(
      service.updateMyProfile(userId, initialEtag, { headline: "Second writer loses this update" }),
    ).rejects.toMatchObject({ code: "ETAG_MISMATCH", httpStatus: 409 });
  });

  it("PATCH with the correct If-Match succeeds and updates the field", async () => {
    const userId = await createUser("updater@example.com");
    const etag = computeEtag(await service.getMyProfile(userId));

    const updated = await service.updateMyProfile(userId, etag, {
      headline: "An updated headline value",
    });
    expect(updated.headline).toBe("An updated headline value");
  });

  it("enforces BR-PROF-07: at most 2 name changes per 90-day window", async () => {
    const userId = await createUser("namechange@example.com");

    const etag1 = computeEtag(await service.getMyProfile(userId));
    await service.updateMyProfile(userId, etag1, { full_name: "Name One" });

    const etag2 = computeEtag(await service.getMyProfile(userId));
    await service.updateMyProfile(userId, etag2, { full_name: "Name Two" });

    const etag3 = computeEtag(await service.getMyProfile(userId));
    await expect(
      service.updateMyProfile(userId, etag3, { full_name: "Name Three" }),
    ).rejects.toMatchObject({
      code: "NAME_CHANGE_LIMIT",
      httpStatus: 429,
    });
  });

  it("allows a name change again once the 90-day window has passed", async () => {
    const userId = await createUser("namechange2@example.com");

    const etag1 = computeEtag(await service.getMyProfile(userId));
    await service.updateMyProfile(userId, etag1, { full_name: "Name One" });
    const etag2 = computeEtag(await service.getMyProfile(userId));
    await service.updateMyProfile(userId, etag2, { full_name: "Name Two" });

    now = new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000);
    const etag3 = computeEtag(await service.getMyProfile(userId));
    const result = await service.updateMyProfile(userId, etag3, { full_name: "Name Three" });
    expect(result.full_name).toBe("Name Three");
  });

  it("maintains the weighted search_vector via the profiles/user_skills/user_interests triggers", async () => {
    const userId = await createUser("searchvector@example.com", "Director of Engineering");
    await sql`INSERT INTO skills (name, slug) VALUES ('GraphQL', 'graphql-pf-test')`;
    await sql`INSERT INTO user_skills (user_id, skill_id) VALUES (${userId}, (SELECT id FROM skills WHERE slug = 'graphql-pf-test'))`;

    const rows =
      await sql`SELECT search_vector @@ to_tsquery('simple', 'GraphQL') AS matches FROM profiles WHERE user_id = ${userId}`;
    expect((rows[0] as { matches: boolean }).matches).toBe(true);
  });
});
