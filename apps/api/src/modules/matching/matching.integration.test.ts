import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import * as schema from "@convene/db";
import { drizzle } from "drizzle-orm/postgres-js";
import Redis from "ioredis";
import postgres from "postgres";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CacheService } from "../../common/cache/cache.service";
import { FeedCacheInvalidationListener } from "./services/feed-cache-invalidation.listener";
import { MatchingDataRepository } from "./repositories/matching-data.repository";
import { MatchingService } from "./services/matching.service";
import { StaticComponentsService } from "./services/static-components.service";

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
  "0012_schedule_intents",
];

// PRD §11.7's own acceptance criterion: "Precompute and live paths agree
// to within floating-point tolerance" — i.e. the offline worker must be a
// pure optimisation (caching StaticComponentsService's own output), never
// a second, independently-drifting implementation. Verified here against
// real Postgres because the one real risk isn't the shared function (it's
// literally the same function either way — see static-components.
// service.ts's own comment) but the storage round-trip itself:
// match_candidates.static_score is numeric(5,4), and components is jsonb.
describe.skipIf(!dockerAvailable)("Matching (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dataRepository: MatchingDataRepository;
  let staticComponents: StaticComponentsService;

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
    await sql`DELETE FROM match_candidates`;
    await sql`DELETE FROM connections`;
    await sql`DELETE FROM user_skills`;
    await sql`DELETE FROM user_interests`;
    await sql`DELETE FROM user_languages`;
    await sql`DELETE FROM user_intents`;
    await sql`DELETE FROM profiles`;
    await sql`DELETE FROM users`;

    const postgresService = { db } as never;
    dataRepository = new MatchingDataRepository(postgresService);
    staticComponents = new StaticComponentsService(dataRepository);
  });

  async function createUser(suffix: string): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"match-test-" + suffix + "-" + Math.random().toString(36).slice(2) + "@example.com"}, ${"User " + suffix}, '1990-01-01', 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id, years_experience) VALUES (${userId}, 5)`;
    return userId;
  }

  it("the offline worker's write matches StaticComponentsService.compute() exactly (same function, storage round-trip only)", async () => {
    const viewerId = await createUser("viewer");
    const candidateId = await createUser("candidate");
    await sql`
      INSERT INTO connections (user_a_id, user_b_id, requester_id)
      SELECT least(${viewerId}::uuid, u.id), greatest(${viewerId}::uuid, u.id), ${viewerId}
      FROM (SELECT ${await createUser("mutual")}::uuid AS id) u
    `;

    const live = await staticComponents.compute(viewerId, candidateId);

    // What match-precompute.service.ts's private upsert() does — inlined
    // here rather than reaching into a private method, using the exact
    // same column types (numeric(5,4), jsonb) the real worker writes.
    await sql`
      INSERT INTO match_candidates (user_id, candidate_id, static_score, components)
      VALUES (${viewerId}, ${candidateId}, ${live.staticScore.toFixed(4)}, ${JSON.stringify(live.components)}::jsonb)
    `;

    const [precomputedRow] = await dataRepository.loadPrecomputedCandidates(viewerId, 10);
    expect(precomputedRow).toBeDefined();
    expect(precomputedRow!.candidateId).toBe(candidateId);

    // jsonb round-trip: exact.
    expect(precomputedRow!.components).toEqual(live.components);
    // numeric(5,4) round-trip: within its own 0.00005 rounding tolerance.
    expect(Math.abs(precomputedRow!.staticScore - live.staticScore)).toBeLessThan(0.0001);
  });

  it("computing the same pair twice live (no caching in StaticComponentsService itself) is deterministic — precompute couldn't silently drift even if it recomputed instead of storing", async () => {
    const viewerId = await createUser("viewer");
    const candidateId = await createUser("candidate");

    const first = await staticComponents.compute(viewerId, candidateId);
    const second = await staticComponents.compute(viewerId, candidateId);

    expect(second.components).toEqual(first.components);
    expect(second.staticScore).toBe(first.staticScore);
  });
});

// PRD §17.6: "Redis: discovery feed ... invalidation: availability.*,
// intent.changed, own actions." Verified against real Redis (BullMQ/
// cache tests in this codebase always use a real broker — a mock can't
// prove an actual SET/DEL round-trips) that firing intent.changed clears
// the cached feed entry within the same event-handler tick, i.e. "within
// one request" — the very next getFeed() call is guaranteed a cache miss,
// not a stale hit for up to 90s.
describe.skipIf(!dockerAvailable)("Feed cache invalidation (Testcontainers)", () => {
  let container: StartedRedisContainer;
  let client: Redis;

  beforeAll(async () => {
    container = await new RedisContainer("redis:7-alpine").start();
    client = new Redis(container.getConnectionUrl(), { maxRetriesPerRequest: null });
  }, 60_000);

  afterAll(async () => {
    client?.disconnect();
    await container?.stop();
  });

  it("intent.changed invalidates the viewer's cached feed entry immediately", async () => {
    const redisService = { client } as never;
    const cache = new CacheService(redisService);
    const matchingService = {
      invalidateFeedCache: (userId: string) => cache.invalidate(`feed:${userId}:discover`),
    } as unknown as import("./services/matching.service").MatchingService;
    const listener = new FeedCacheInvalidationListener(matchingService);

    const cacheKey = "feed:user-real-1:discover";
    await cache.getOrSet(cacheKey, 90, async () => ({ matches: ["stale"] }));
    expect(await client.get(cacheKey)).not.toBeNull();

    await listener.handleIntentChanged({
      userId: "user-real-1",
      intentId: "intent-1",
      type: "coffee_chat",
    });

    expect(await client.get(cacheKey)).toBeNull();
  });
});
