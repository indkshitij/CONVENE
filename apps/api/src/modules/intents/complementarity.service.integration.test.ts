import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_COMPLEMENTARITY_MATRIX } from "@convene/matching";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheService } from "../../common/cache/cache.service";
import { ComplementarityService } from "./complementarity.service";

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

// P8.2, run against a real Postgres (see otp.service.integration.test.ts
// for why).
describe.skipIf(!dockerAvailable)("ComplementarityService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

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
    await sql`DELETE FROM intent_complementarity`;
  });

  function makeService(): ComplementarityService {
    const postgresService = { db } as never;
    const cache = new CacheService({ client: new FakeRedisClient() } as never);
    return new ComplementarityService(postgresService, cache);
  }

  it("falls back to DEFAULT_COMPLEMENTARITY_MATRIX when the table is empty", async () => {
    const service = makeService();
    const matrix = await service.getMatrix();
    expect(matrix).toEqual(DEFAULT_COMPLEMENTARITY_MATRIX);
  });

  it("loads a DB-seeded override and reflects it in score()/bestPair()", async () => {
    await sql`INSERT INTO intent_complementarity (from_type, to_type, weight) VALUES ('coffee_chat', 'coffee_chat', 0.10)`;
    const service = makeService();

    const matrix = await service.getMatrix();
    expect(matrix.coffee_chat.coffee_chat).toBe(0.1);

    const pair = await service.bestPair(
      [{ type: "coffee_chat", isPrimary: false }],
      [{ type: "coffee_chat", isPrimary: false }],
    );
    expect(pair).toEqual({ viewerType: "coffee_chat", candidateType: "coffee_chat", weight: 0.1 });
  });

  it("caches the matrix in-process: a second call within the TTL doesn't hit Postgres again", async () => {
    const service = makeService();
    const selectSpy = vi.spyOn(db, "select");

    await service.getMatrix();
    const callsAfterFirst = selectSpy.mock.calls.length;
    await service.getMatrix();
    expect(selectSpy.mock.calls.length).toBe(callsAfterFirst);
    selectSpy.mockRestore();
  });
});
