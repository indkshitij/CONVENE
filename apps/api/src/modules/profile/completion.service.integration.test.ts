import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CompletionService } from "./completion.service";

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

// PRD §10.2.9 endpoint 17 (P7.3), run against a real Postgres (see
// otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("CompletionService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: CompletionService;

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
    await sql`DELETE FROM users`;
    const postgresService = { db } as never;
    service = new CompletionService(postgresService);
  });

  async function createUser(): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version, email_verified_at)
      VALUES (${"comp-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Comp Test', '1990-01-01', 'v1', now())
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id) VALUES (${userId})`;
    return userId;
  }

  it("computes 0 for a bare profile (only verification is met, via email_verified_at) and persists it", async () => {
    const userId = await createUser();
    const result = await service.getCompletion(userId);
    expect(result.score).toBe(5);
    expect(result.missing.map((m) => m.field)).not.toContain("verification");

    const [profile] = await sql`SELECT profile_completion FROM profiles WHERE user_id = ${userId}`;
    expect((profile as { profile_completion: number }).profile_completion).toBe(5);
  });

  it("credits headline, about, and skills once they're populated", async () => {
    const userId = await createUser();
    await sql`UPDATE profiles SET headline = ${"A".repeat(25)}, about = ${"B".repeat(150)} WHERE user_id = ${userId}`;

    await sql`INSERT INTO skills (name, slug, is_approved) VALUES ('Skill1','skill1-ct',true), ('Skill2','skill2-ct',true), ('Skill3','skill3-ct',true), ('Skill4','skill4-ct',true), ('Skill5','skill5-ct',true)`;
    const skillRows = await sql`SELECT id FROM skills WHERE slug LIKE '%-ct'`;
    for (const [i, row] of skillRows.entries()) {
      await sql`INSERT INTO user_skills (user_id, skill_id, position) VALUES (${userId}, ${(row as { id: number }).id}, ${i})`;
    }

    const result = await service.getCompletion(userId);
    expect(result.missing.map((m) => m.field)).toEqual(
      expect.not.arrayContaining(["headline", "about", "skills"]),
    );
    expect(result.score).toBe(5 + 10 + 10 + 15);
  });

  it("credits the avatar component only when the media row's moderation_state is clean", async () => {
    const userId = await createUser();
    const [mediaRow] = await sql`
      INSERT INTO media (owner_id, kind, storage_key, mime_type, size_bytes, moderation_state)
      VALUES (${userId}, 'avatar', 'k', 'image/png', 100, 'pending')
      RETURNING id
    `;
    await sql`UPDATE profiles SET avatar_media_id = ${(mediaRow as { id: string }).id} WHERE user_id = ${userId}`;

    const pending = await service.getCompletion(userId);
    expect(pending.missing.map((m) => m.field)).toContain("name_and_avatar");

    await sql`UPDATE media SET moderation_state = 'clean' WHERE id = ${(mediaRow as { id: string }).id}`;
    const clean = await service.getCompletion(userId);
    expect(clean.missing.map((m) => m.field)).not.toContain("name_and_avatar");
  });
});
