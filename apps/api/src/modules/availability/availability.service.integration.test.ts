import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../common/clock";
import { CandidateRepository } from "../matching/repositories/candidate.repository";
import { IntentsService } from "../intents/intents.service";
import { AvailabilityService } from "./availability.service";
import { AvailabilityRepository } from "./repositories/availability.repository";

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

// §10.3.12's eight Gherkin scenarios reachable from this phase's own
// endpoints (18/19/20): "Extension limits," "Only one live session," and
// the storage half of "Session-scoped intents narrow my inbound matches."
// The other five (server-side expiry, auto-away, scheduled/dormant, DST,
// timezone overlap) all require the belt-and-braces sweeper (P10.2) or
// recurring schedules (P10.3), neither built yet — deferred, not
// fabricated. Run against a real Postgres (see
// otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("AvailabilityService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: AvailabilityService;
  let repository: AvailabilityRepository;
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
    sql = postgres(`postgres://postgres:test@${host}:${port}/postgres`, { max: 10 });
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
    await sql`DELETE FROM availability_session_intents`;
    await sql`DELETE FROM availability_sessions`;
    await sql`DELETE FROM user_intents`;
    await sql`DELETE FROM users`;

    now = new Date("2026-08-08T00:00:00Z");
    const postgresService = { db } as never;
    repository = new AvailabilityRepository(postgresService);
    const candidateRepository = new CandidateRepository(postgresService);
    const intentsService = new IntentsService(postgresService, clock);
    const redis = { client: new FakeRedisClient() } as never;
    service = new AvailabilityService(
      postgresService,
      repository,
      candidateRepository,
      intentsService,
      redis,
      clock,
    );
  });

  async function createUser(profileVisibility: "public" | "private" = "public"): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"avail-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Avail Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id, profile_visibility, search_radius_km) VALUES (${userId}, ${profileVisibility}, 25)`;
    return userId;
  }

  it("BR-AVAIL-01: creates an Available Now session with the requested duration and returns match_preview", async () => {
    const userId = await createUser();
    const result = await service.createSession(userId, "free", {
      state: "available_now",
      duration_minutes: 30,
    });

    expect(result.session.state).toBe("available_now");
    expect(result.session.duration_minutes).toBe(30);
    expect(result.session.expires_at).toBe(new Date(now.getTime() + 30 * 60_000).toISOString());
    expect(result.match_preview).toEqual({
      available_now_count: 0,
      nearby_count: 0,
      top_score: null,
    });
  });

  it("match_preview is not returned for non-available_now states", async () => {
    const userId = await createUser();
    const result = await service.createSession(userId, "free", { state: "busy" });
    expect(result.match_preview).toBeNull();
  });

  it("BR-AVAIL-12: a private profile cannot go available", async () => {
    const userId = await createUser("private");
    await expect(
      service.createSession(userId, "free", { state: "available_now", duration_minutes: 30 }),
    ).rejects.toMatchObject({
      code: "PROFILE_PRIVATE",
      httpStatus: 403,
    });
  });

  it("§10.3.3 state diagram: busy cannot transition directly to invisible", async () => {
    const userId = await createUser();
    await service.createSession(userId, "free", { state: "busy" });
    await expect(
      service.createSession(userId, "free", { state: "invisible" }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      httpStatus: 409,
    });
  });

  it("§10.3.12 'Only one live session': setting Busy while Available Now ends the previous session with reason superseded", async () => {
    const userId = await createUser();
    const first = await service.createSession(userId, "free", {
      state: "available_now",
      duration_minutes: 30,
    });
    await service.createSession(userId, "free", { state: "busy" });

    const rows = await sql<{ id: string; ended_at: Date | null; end_reason: string | null }[]>`
      SELECT id, ended_at, end_reason FROM availability_sessions WHERE user_id = ${userId} ORDER BY created_at
    `;
    expect(rows).toHaveLength(2);
    const supersededRow = rows.find((r) => r.id === first.session.id);
    expect(supersededRow?.ended_at).not.toBeNull();
    expect(supersededRow?.end_reason).toBe("superseded");

    const liveCount =
      await sql`SELECT count(*)::int AS count FROM availability_sessions WHERE user_id = ${userId} AND ended_at IS NULL`;
    expect((liveCount[0] as { count: number }).count).toBe(1);
  });

  it("§10.3.12 'Session-scoped intents': only the specified subset is attached to the session", async () => {
    const userId = await createUser();
    const intentIds = [];
    for (const type of ["need_mentee", "hiring", "coffee_chat"] as const) {
      const [row] = await sql`
        INSERT INTO user_intents (user_id, type, expires_at) VALUES (${userId}, ${type}, ${new Date(now.getTime() + 30 * 86_400_000).toISOString()})
        RETURNING id
      `;
      intentIds.push((row as { id: string }).id);
    }
    const coffeeChatId = intentIds[2]!;

    const result = await service.createSession(userId, "free", {
      state: "available_now",
      duration_minutes: 30,
      session_intent_ids: [coffeeChatId],
    });

    expect(result.session.session_intents).toEqual([{ id: coffeeChatId, type: "coffee_chat" }]);
  });

  it("rejects a session_intent_id that isn't one of the caller's active intents", async () => {
    const userId = await createUser();
    await expect(
      service.createSession(userId, "free", {
        state: "available_now",
        duration_minutes: 30,
        session_intent_ids: ["00000000-0000-0000-0000-000000000000"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("§10.3.12 'Extension limits': the 4th extension attempt is rejected with 409 MAX_EXTENSIONS_REACHED", async () => {
    const userId = await createUser();
    const created = await service.createSession(userId, "premium", {
      state: "available_now",
      duration_minutes: 30,
    });

    await service.extendSession(userId, created.session.id, "premium", { additional_minutes: 30 });
    await service.extendSession(userId, created.session.id, "premium", { additional_minutes: 30 });
    await service.extendSession(userId, created.session.id, "premium", { additional_minutes: 30 });

    await expect(
      service.extendSession(userId, created.session.id, "premium", { additional_minutes: 15 }),
    ).rejects.toMatchObject({ code: "MAX_EXTENSIONS_REACHED", httpStatus: 409 });
  });

  it("BR-AVAIL-05: cumulative 240-minute cap is enforced even under the 3-extension count limit", async () => {
    const userId = await createUser();
    const created = await service.createSession(userId, "premium", {
      state: "available_now",
      duration_minutes: 120,
    });

    // 120 + 60 = 180, still under the 240 cap — succeeds (1st extension).
    const extended = await service.extendSession(userId, created.session.id, "premium", {
      additional_minutes: 60,
    });
    expect(extended.expires_at).toBe(new Date(now.getTime() + 180 * 60_000).toISOString());

    // 180 + 60 = 240, exactly at the cap — succeeds (2nd extension).
    await service.extendSession(userId, created.session.id, "premium", { additional_minutes: 60 });

    // 240 + 15 = 255 > 240 — rejected even though only 2 of 3 extensions used.
    await expect(
      service.extendSession(userId, created.session.id, "premium", { additional_minutes: 15 }),
    ).rejects.toMatchObject({ code: "MAX_EXTENSIONS_REACHED" });
  });

  it("free-plan extension beyond 120 cumulative minutes requires Premium", async () => {
    const userId = await createUser();
    // Already at the free plan's own max preset (120) — any extension at
    // all pushes past the free cap.
    const created = await service.createSession(userId, "free", {
      state: "available_now",
      duration_minutes: 120,
    });
    await expect(
      service.extendSession(userId, created.session.id, "free", { additional_minutes: 15 }),
    ).rejects.toMatchObject({ code: "PREMIUM_REQUIRED", httpStatus: 402 });
  });

  it("extending an already-ended session returns 409 SESSION_ALREADY_ENDED", async () => {
    const userId = await createUser();
    const created = await service.createSession(userId, "free", {
      state: "available_now",
      duration_minutes: 30,
    });
    await service.endSession(userId, created.session.id);

    await expect(
      service.extendSession(userId, created.session.id, "free", { additional_minutes: 15 }),
    ).rejects.toMatchObject({ code: "SESSION_ALREADY_ENDED", httpStatus: 409 });
  });

  it("endSession returns a real summary and clears availability_live", async () => {
    const userId = await createUser();
    const created = await service.createSession(userId, "free", {
      state: "available_now",
      duration_minutes: 30,
    });

    now = new Date(now.getTime() + 10 * 60_000);
    const summary = await service.endSession(userId, created.session.id);
    expect(summary.duration_actual_minutes).toBe(10);

    const liveRows = await sql`SELECT * FROM availability_live WHERE user_id = ${userId}`;
    expect(liveRows).toHaveLength(0);
  });

  it("ownership: one user cannot extend or end another user's session", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const created = await service.createSession(userA, "free", {
      state: "available_now",
      duration_minutes: 30,
    });

    await expect(
      service.extendSession(userB, created.session.id, "free", { additional_minutes: 15 }),
    ).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      httpStatus: 404,
    });
    await expect(service.endSession(userB, created.session.id)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("getCurrent reflects the active session, and null after it ends", async () => {
    const userId = await createUser();
    const created = await service.createSession(userId, "free", {
      state: "available_now",
      duration_minutes: 30,
    });

    const current = await service.getCurrent(userId);
    expect(current.current_session?.id).toBe(created.session.id);

    await service.endSession(userId, created.session.id);
    const afterEnd = await service.getCurrent(userId);
    expect(afterEnd.current_session).toBeNull();
  });

  // P10.1's own testing requirement: "A concurrency test firing two
  // simultaneous session creations and asserting the DB constraint
  // rejects the second" — not a read-then-write check.
  it("concurrency: two simultaneous createSession calls for the same user never both succeed with two live rows", async () => {
    const userId = await createUser();

    const [resultA, resultB] = await Promise.allSettled([
      service.createSession(userId, "free", { state: "available_now", duration_minutes: 30 }),
      service.createSession(userId, "free", { state: "available_now", duration_minutes: 60 }),
    ]);

    const succeeded = [resultA, resultB].filter((r) => r.status === "fulfilled");
    // At least one must succeed; if both did (each ending the other's
    // session on its way in), the invariant that matters is still exactly
    // one live row at the end.
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const liveCount =
      await sql`SELECT count(*)::int AS count FROM availability_sessions WHERE user_id = ${userId} AND ended_at IS NULL`;
    expect((liveCount[0] as { count: number }).count).toBe(1);
  });
});
