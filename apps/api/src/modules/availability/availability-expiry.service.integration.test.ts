import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock } from "../../common/clock";
import { availabilityKey, presenceKey } from "../../infra/redis/keys";
import { AvailabilityExpiryService } from "./availability-expiry.service";
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

// PRD §10.3.10 + P10.2's own testing requirement: both mechanisms must be
// independently sufficient, and double-processing must produce exactly
// one event. Run against a real Postgres (see
// otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("AvailabilityExpiryService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
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
    await sql`DELETE FROM availability_sessions`;
    await sql`DELETE FROM users`;
    now = new Date("2026-08-08T00:00:00Z");
    const postgresService = { db } as never;
    repository = new AvailabilityRepository(postgresService);
  });

  function makeExpiryService(
    events?: { emit: ReturnType<typeof vi.fn> },
    redisClient: FakeRedisClient = new FakeRedisClient(),
  ) {
    const redis = { client: redisClient } as never;
    return new AvailabilityExpiryService(repository, redis, clock, events as never);
  }

  async function createUserWithSession(
    expiresInMinutes: number,
  ): Promise<{ userId: string; sessionId: string }> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"expiry-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Expiry Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id) VALUES (${userId})`;
    const [session] = await sql`
      INSERT INTO availability_sessions (user_id, state, started_at, expires_at, duration_minutes)
      VALUES (${userId}, 'available_now', ${now.toISOString()}, ${new Date(now.getTime() + expiresInMinutes * 60_000).toISOString()}, 30)
      RETURNING id
    `;
    await sql`INSERT INTO availability_live (user_id, state, session_id, expires_at) VALUES (${userId}, 'available_now', ${(session as { id: string }).id}, ${new Date(now.getTime() + expiresInMinutes * 60_000).toISOString()})`;
    return { userId, sessionId: (session as { id: string }).id };
  }

  it("the sweeper (braces) alone expires a session whose expiry has passed", async () => {
    const events = { emit: vi.fn() };
    const service = makeExpiryService(events);
    const { userId, sessionId } = await createUserWithSession(-1); // already expired

    const count = await service.sweepExpired();
    expect(count).toBe(1);

    const [row] =
      await sql`SELECT ended_at, end_reason FROM availability_sessions WHERE id = ${sessionId}`;
    expect((row as { ended_at: Date | null }).ended_at).not.toBeNull();
    expect((row as { end_reason: string }).end_reason).toBe("expired");

    const liveRows = await sql`SELECT * FROM availability_live WHERE user_id = ${userId}`;
    expect(liveRows).toHaveLength(0);
    expect(events.emit).toHaveBeenCalledWith(
      "availability.expired",
      expect.objectContaining({ userId, sessionId }),
    );
  });

  it("the keyspace listener (belt) alone expires a session — the sweeper is never called", async () => {
    const events = { emit: vi.fn() };
    const service = makeExpiryService(events);
    const { userId, sessionId } = await createUserWithSession(15);

    // Simulates the keyspace-notification path directly (expireByUserId
    // is exactly what the listener calls on a Redis TTL expiry event) —
    // sweepExpired/warnExpiringSoon are never invoked in this test.
    await service.expireByUserId(userId);

    const [row] = await sql`SELECT ended_at FROM availability_sessions WHERE id = ${sessionId}`;
    expect((row as { ended_at: Date | null }).ended_at).not.toBeNull();
    expect(events.emit).toHaveBeenCalledWith(
      "availability.expired",
      expect.objectContaining({ userId, sessionId }),
    );
  });

  it("double expiry (both mechanisms firing) produces exactly one availability.expired event", async () => {
    const events = { emit: vi.fn() };
    const service = makeExpiryService(events);
    const { userId, sessionId } = await createUserWithSession(-1);

    await Promise.all([service.expireSession(sessionId), service.expireByUserId(userId)]);

    const expiredEmits = events.emit.mock.calls.filter(
      (call) => call[0] === "availability.expired",
    );
    expect(expiredEmits).toHaveLength(1);
  });

  it("expiring an already-ended session is a no-op (idempotent) and emits nothing", async () => {
    const events = { emit: vi.fn() };
    const service = makeExpiryService(events);
    const { sessionId } = await createUserWithSession(-1);

    await service.expireSession(sessionId);
    events.emit.mockClear();

    await service.expireSession(sessionId);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("BR-AVAIL-06: warns once for a session inside the 5-minute window, and doesn't re-warn on a later tick", async () => {
    const events = { emit: vi.fn() };
    const redisClient = new FakeRedisClient();
    const service = makeExpiryService(events, redisClient);
    await createUserWithSession(3);

    const firstPass = await service.warnExpiringSoon();
    expect(firstPass).toBe(1);
    expect(events.emit).toHaveBeenCalledWith(
      "availability.expiring_soon",
      expect.objectContaining({ minutesRemaining: 3 }),
    );

    events.emit.mockClear();
    const secondPass = await service.warnExpiringSoon(); // simulates the next 30s sweeper tick
    expect(secondPass).toBe(0);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("does not warn a session outside the 5-minute window", async () => {
    const service = makeExpiryService();
    await createUserWithSession(10);
    expect(await service.warnExpiringSoon()).toBe(0);
  });

  it("BR-AVAIL-07: sets Away when presence shows inactive for over 10 minutes", async () => {
    const events = { emit: vi.fn() };
    const redisClient = new FakeRedisClient();
    const { userId, sessionId } = await createUserWithSession(60);
    await redisClient.set(
      presenceKey(userId),
      JSON.stringify({
        active: false,
        lastBeat: new Date(now.getTime() - 11 * 60_000).toISOString(),
      }),
    );
    const service = makeExpiryService(events, redisClient);

    const result = await service.checkPresenceDrivenTransitions();
    expect(result.awaySet).toBe(1);

    const [row] = await sql`SELECT state FROM availability_sessions WHERE id = ${sessionId}`;
    expect((row as { state: string }).state).toBe("away");
    expect(events.emit).toHaveBeenCalledWith(
      "availability.changed",
      expect.objectContaining({ userId, state: "away" }),
    );
  });

  it("does not set Away when presence shows recent activity", async () => {
    const redisClient = new FakeRedisClient();
    const { userId, sessionId } = await createUserWithSession(60);
    await redisClient.set(
      presenceKey(userId),
      JSON.stringify({ active: true, lastBeat: now.toISOString() }),
    );
    const service = makeExpiryService(undefined, redisClient);

    const result = await service.checkPresenceDrivenTransitions();
    expect(result.awaySet).toBe(0);
    const [row] = await sql`SELECT state FROM availability_sessions WHERE id = ${sessionId}`;
    expect((row as { state: string }).state).toBe("available_now");
  });

  it("BR-AVAIL-07 recovery: recoverFromAway restores available_now with the original expires_at unchanged", async () => {
    const events = { emit: vi.fn() };
    const { sessionId } = await createUserWithSession(60);
    const [before] =
      await sql`SELECT expires_at FROM availability_sessions WHERE id = ${sessionId}`;

    const service = makeExpiryService(events);
    await service.recoverFromAway(sessionId);

    const [after] =
      await sql`SELECT state, expires_at FROM availability_sessions WHERE id = ${sessionId}`;
    expect((after as { state: string }).state).toBe("available_now");
    expect((after as { expires_at: Date }).expires_at).toEqual(
      (before as { expires_at: Date }).expires_at,
    );
  });

  it("BR-AVAIL-08: ends a session with reason 'disconnected' when no presence key exists past the grace period", async () => {
    const { userId, sessionId } = await createUserWithSession(60);
    // startedAt is `now`; advance the clock past the 5-minute grace period.
    now = new Date(now.getTime() + 6 * 60_000);
    const service = makeExpiryService(undefined);

    const result = await service.checkPresenceDrivenTransitions();
    expect(result.disconnected).toBe(1);

    const [row] =
      await sql`SELECT ended_at, end_reason FROM availability_sessions WHERE id = ${sessionId}`;
    expect((row as { ended_at: Date | null }).ended_at).not.toBeNull();
    expect((row as { end_reason: string }).end_reason).toBe("disconnected");

    const liveRows = await sql`SELECT * FROM availability_live WHERE user_id = ${userId}`;
    expect(liveRows).toHaveLength(0);
  });

  it("clears the Redis avail:{userId} key on expiry", async () => {
    const redisClient = new FakeRedisClient();
    await redisClient.set(availabilityKey("placeholder"), "irrelevant"); // sanity: key helper is exercised elsewhere too
    const { userId, sessionId } = await createUserWithSession(-1);
    await redisClient.set(availabilityKey(userId), JSON.stringify({ state: "available_now" }));
    const service = makeExpiryService(undefined, redisClient);

    await service.expireSession(sessionId);
    expect(await redisClient.get(availabilityKey(userId))).toBeNull();
  });
});
