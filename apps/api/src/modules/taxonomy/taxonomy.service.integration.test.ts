import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheService } from "../../common/cache/cache.service";
import { TaxonomyService } from "./taxonomy.service";

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

// PRD §10.1.7 endpoint 62 + BR-PROF-02, run against a real Postgres (see
// otp.service.integration.test.ts for why the k-anonymity-style ILIKE/
// trigram queries need a real DB rather than a mocked query builder).
describe.skipIf(!dockerAvailable)("TaxonomyService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: TaxonomyService;

  beforeAll(async () => {
    container = await GenericContainer.fromDockerfile(dockerContextDir)
      .build()
      .then((image) =>
        image.withExposedPorts(5432).withEnvironment({ POSTGRES_PASSWORD: "test" }).start(),
      );

    const port = container.getMappedPort(5432);
    const host = container.getHost();
    sql = postgres(`postgres://postgres:test@${host}:${port}/postgres`, { max: 1 });
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
    await sql`DELETE FROM user_skills`;
    await sql`DELETE FROM skills`;
    await sql`DELETE FROM cities`;
    await sql`DELETE FROM states`;
    await sql`DELETE FROM countries`;

    const postgresService = { db } as never;
    const redis = { client: new FakeRedisClient() };
    const cache = new CacheService(redis as never);
    service = new TaxonomyService(postgresService, cache);

    await sql`
      INSERT INTO skills (name, slug, aliases, is_approved, usage_count)
      VALUES
        ('React', 'react', ARRAY['ReactJS', 'React.js'], true, 100),
        ('Kubernetes', 'kubernetes', ARRAY['K8s'], true, 50),
        ('Requested Skill', 'requested-skill', NULL, false, 1)
    `;

    await sql`INSERT INTO countries (code, name) VALUES ('IN', 'India')`;
    await sql`INSERT INTO states (country_code, name) VALUES ('IN', 'Karnataka')`;
    await sql`
      INSERT INTO cities (state_id, country_code, name, timezone)
      VALUES
        ((SELECT id FROM states WHERE name = 'Karnataka'), 'IN', 'Bengaluru', 'Asia/Kolkata'),
        ((SELECT id FROM states WHERE name = 'Karnataka'), 'IN', 'Bengaluru Rural', 'Asia/Kolkata')
    `;
  });

  it("finds a skill by an alias, not just its canonical name", async () => {
    const results = await service.getSkills("ReactJS");
    expect(results.map((s) => s.name)).toContain("React");
  });

  it("finds a skill by a substring of its canonical name", async () => {
    const results = await service.getSkills("kuber");
    expect(results.map((s) => s.name)).toContain("Kubernetes");
  });

  it("getApprovedSkillsForMatching excludes unapproved skills", async () => {
    const approved = await service.getApprovedSkillsForMatching();
    expect(approved.map((s) => s.name)).toEqual(expect.arrayContaining(["React", "Kubernetes"]));
    expect(approved.map((s) => s.name)).not.toContain("Requested Skill");
  });

  it("resolveOrCreateSkill matches an existing alias and increments usage_count instead of duplicating", async () => {
    const resolved = await service.resolveOrCreateSkill("React.js");
    expect(resolved.name).toBe("React");
    expect(resolved.usageCount).toBe(101);

    const all = await sql`SELECT count(*)::int AS count FROM skills WHERE name = 'React'`;
    expect((all[0] as { count: number }).count).toBe(1);
  });

  it("resolveOrCreateSkill creates a new unapproved skill for an unmatched name", async () => {
    const created = await service.resolveOrCreateSkill("Zig Programming");
    expect(created.isApproved).toBe(false);
    expect(created.usageCount).toBe(1);

    const approved = await service.getApprovedSkillsForMatching();
    expect(approved.map((s) => s.name)).not.toContain("Zig Programming");
  });

  it("resolveOrCreateSkill accumulates usage_count on repeated requests for the same not-yet-approved name", async () => {
    await service.resolveOrCreateSkill("Zig Programming");
    const second = await service.resolveOrCreateSkill("zig programming"); // case-insensitive match
    expect(second.usageCount).toBe(2);

    const all = await sql`SELECT count(*)::int AS count FROM skills WHERE name = 'Zig Programming'`;
    expect((all[0] as { count: number }).count).toBe(1);
  });

  it("resolveOrCreateInterest reuses an existing interest case-insensitively", async () => {
    await sql`INSERT INTO interests (name, slug) VALUES ('Cycling', 'cycling-pf-test')`;
    const resolved = await service.resolveOrCreateInterest("cycling");
    expect(resolved.name).toBe("Cycling");

    const all =
      await sql`SELECT count(*)::int AS count FROM interests WHERE lower(name) = 'cycling'`;
    expect((all[0] as { count: number }).count).toBe(1);
  });

  it("resolveOrCreateInterest creates a new interest for an unmatched name", async () => {
    const created = await service.resolveOrCreateInterest("Competitive chess");
    expect(created.name).toBe("Competitive chess");
    expect(created.slug).toBe("competitive-chess");
  });

  it("city search uses trigram matching and tolerates a substring query", async () => {
    const results = await service.getCities("Bengaluru");
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Bengaluru", "Bengaluru Rural"]),
    );
  });

  it("caches the unfiltered skills listing: a second call doesn't hit Postgres again", async () => {
    const selectSpy = vi.spyOn(db, "select");
    const postgresService = { db } as never;
    const redis = { client: new FakeRedisClient() };
    const cache = new CacheService(redis as never);
    const freshService = new TaxonomyService(postgresService, cache);

    await freshService.getSkills();
    const callsAfterFirst = selectSpy.mock.calls.length;
    await freshService.getSkills();
    expect(selectSpy.mock.calls.length).toBe(callsAfterFirst); // no new .select() call
    selectSpy.mockRestore();
  });
});
