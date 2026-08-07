import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "./embedding-provider";
import { EmbeddingService } from "./embedding.service";

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

// P7.4 prompt's own testing requirement: "assert no provider call occurs
// on an unrelated profile update," run against a real Postgres (see
// otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("EmbeddingService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: EmbeddingService;
  let provider: { embed: ReturnType<typeof vi.fn> };

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
    await sql`DELETE FROM profile_embeddings`;
    await sql`DELETE FROM users`;
    const postgresService = { db } as never;
    provider = {
      embed: vi.fn(async (text: string) =>
        new Array(1024).fill(0).map((_, i) => (i === 0 ? text.length : 0)),
      ),
    };
    service = new EmbeddingService(postgresService, provider as unknown as EmbeddingProvider);
  });

  async function createUser(headline = "Original headline"): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"emb-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Emb Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id, headline) VALUES (${userId}, ${headline})`;
    return userId;
  }

  it("calls the provider and stores the embedding on first refresh", async () => {
    const userId = await createUser();
    const result = await service.refreshEmbedding(userId);
    expect(result.skipped).toBe(false);
    expect(provider.embed).toHaveBeenCalledTimes(1);

    const [row] =
      await sql`SELECT model, source_hash FROM profile_embeddings WHERE user_id = ${userId}`;
    expect((row as { model: string }).model).toBe("voyage-3");
  });

  it("skips the provider call on a second refresh when nothing changed", async () => {
    const userId = await createUser();
    await service.refreshEmbedding(userId);
    provider.embed.mockClear();

    const result = await service.refreshEmbedding(userId);
    expect(result.skipped).toBe(true);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("skips the provider call when only an unrelated field (not headline/about/job_title/skills/industry) changes", async () => {
    const userId = await createUser();
    await service.refreshEmbedding(userId);
    provider.embed.mockClear();

    // timezone isn't one of the five composed fields — refreshEmbedding
    // recomposes to identical text regardless.
    await sql`UPDATE profiles SET timezone = 'Asia/Kolkata' WHERE user_id = ${userId}`;
    const result = await service.refreshEmbedding(userId);
    expect(result.skipped).toBe(true);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("calls the provider again once a composed field (headline) actually changes", async () => {
    const userId = await createUser("Original headline");
    await service.refreshEmbedding(userId);
    provider.embed.mockClear();

    await sql`UPDATE profiles SET headline = 'A brand new headline' WHERE user_id = ${userId}`;
    const result = await service.refreshEmbedding(userId);
    expect(result.skipped).toBe(false);
    expect(provider.embed).toHaveBeenCalledTimes(1);
  });
});
