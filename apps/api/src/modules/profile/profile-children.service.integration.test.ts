import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { experiences, userLanguages, userSkills } from "@convene/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../common/clock";
import { CacheService } from "../../common/cache/cache.service";
import { TaxonomyService } from "../taxonomy/taxonomy.service";
import { ProfileChildrenService } from "./profile-children.service";

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

// PRD §10.2.9 endpoint 15 (P7.2), run against a real Postgres (see
// otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("ProfileChildrenService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: ProfileChildrenService;
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
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await sql`DELETE FROM user_skills`;
    await sql`DELETE FROM user_interests`;
    await sql`DELETE FROM user_languages`;
    await sql`DELETE FROM experiences`;
    await sql`DELETE FROM users`;

    now = new Date("2026-08-03T00:00:00Z");
    const postgresService = { db } as never;
    const cache = new CacheService({ client: new FakeRedisClient() } as never);
    const taxonomyService = new TaxonomyService(postgresService, cache);
    service = new ProfileChildrenService(postgresService, taxonomyService, clock);
  });

  async function createUser(dob = "1990-01-01"): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"cf-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'CF Test', ${dob}, 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id, headline) VALUES (${userId}, 'A headline for testing')`;
    return userId;
  }

  it("createExperienceValidated recomputes years_experience on the profile", async () => {
    const userId = await createUser();
    const result = await service.createExperienceValidated(userId, {
      company_name: "Xenon Labs",
      title: "Engineer",
      start_date: "2020-01-01",
      end_date: "2022-01-01",
      is_current: false,
    });
    expect(result.years_experience).toBe("2.0");

    const [profile] = await sql`SELECT years_experience FROM profiles WHERE user_id = ${userId}`;
    expect((profile as { years_experience: string }).years_experience).toBe("2.0");
  });

  it("recomputes on update and again on delete", async () => {
    const userId = await createUser();
    const created = await service.createExperienceValidated(userId, {
      company_name: "Xenon Labs",
      title: "Engineer",
      start_date: "2020-01-01",
      end_date: "2022-01-01",
      is_current: false,
    });

    const updated = await service.updateExperience(userId, created.experience.id, {
      end_date: "2023-01-01",
    });
    expect(updated.years_experience).toBe("3.0");

    await service.deleteExperience(userId, created.experience.id);
    const [profile] = await sql`SELECT years_experience FROM profiles WHERE user_id = ${userId}`;
    expect((profile as { years_experience: string }).years_experience).toBe("0.0");
  });

  it("merges overlapping experience ranges (§10.2.12 edge case #1) instead of double-counting", async () => {
    const userId = await createUser();
    await service.createExperienceValidated(userId, {
      company_name: "Company A",
      title: "Engineer",
      start_date: "2020-01-01",
      end_date: "2022-01-01",
      is_current: false,
    });
    const result = await service.createExperienceValidated(userId, {
      company_name: "Company B (side project)",
      title: "Advisor",
      start_date: "2021-01-01",
      end_date: "2021-06-01",
      is_current: false,
    });
    expect(result.years_experience).toBe("2.0"); // union span, not 2 + 0.5
  });

  it("stops recomputing once years_experience_override is set, and flags a suspicious override", async () => {
    const userId = await createUser();
    await service.createExperienceValidated(userId, {
      company_name: "Xenon Labs",
      title: "Engineer",
      start_date: "2020-01-01",
      end_date: "2022-01-01",
      is_current: false,
    });

    await sql`UPDATE profiles SET years_experience = '20.0', years_experience_override = true WHERE user_id = ${userId}`;

    const result = await service.createExperienceValidated(userId, {
      company_name: "Company C",
      title: "Engineer",
      start_date: "2022-01-01",
      end_date: "2023-01-01",
      is_current: false,
    });

    // Override value untouched by the new experience entry...
    expect(result.years_experience).toBe("20.0");
    const [profile] = await sql`SELECT years_experience FROM profiles WHERE user_id = ${userId}`;
    expect((profile as { years_experience: string }).years_experience).toBe("20.0");
    // ...but flagged, since 20 - (derived ~3) > 3.
    expect(result.years_experience_override_suspicious).toBe(true);
  });

  it("rejects a start_date before DOB + 14 years", async () => {
    // A real adult (chk_adult is checked against the real CURRENT_DATE,
    // not the injected clock) whose experience start_date nonetheless
    // predates their 14th birthday under the fixed test `now`.
    const userId = await createUser("2000-01-01");
    await expect(
      service.createExperienceValidated(userId, {
        company_name: "Too Young Inc",
        title: "Intern",
        start_date: "2010-01-01", // age 10 at this date
        end_date: null,
        is_current: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("ownership: user A cannot update or delete user B's experience row", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const created = await service.createExperienceValidated(userA, {
      company_name: "Xenon Labs",
      title: "Engineer",
      start_date: "2020-01-01",
      end_date: "2022-01-01",
      is_current: false,
    });

    await expect(
      service.updateExperience(userB, created.experience.id, { title: "Hacked" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
    await expect(service.deleteExperience(userB, created.experience.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });

    // Untouched.
    const [row] = await db
      .select()
      .from(experiences)
      .where(eq(experiences.id, created.experience.id));
    expect(row?.title).toBe("Engineer");
  });

  it("replaceSkills resolves free-text names via the taxonomy and preserves position order", async () => {
    const userId = await createUser();
    await service.replaceSkills(userId, {
      skills: [
        { name: "React", proficiency: "expert", years: 5 },
        { name: "Brand New Skill", proficiency: null, years: null },
      ],
    });

    const rows = await db
      .select()
      .from(userSkills)
      .innerJoin(schema.skills, eq(schema.skills.id, userSkills.skillId))
      .where(eq(userSkills.userId, userId))
      .orderBy(userSkills.position);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.skills.name).toBe("React");
    expect(rows[1]?.skills.name).toBe("Brand New Skill");
    expect(rows[1]?.skills.isApproved).toBe(false); // request-only, unapproved by default
  });

  it("replaceSkills fully replaces the previous set (no leftover rows)", async () => {
    const userId = await createUser();
    await service.replaceSkills(userId, { skills: [{ name: "React" }] });
    await service.replaceSkills(userId, { skills: [{ name: "Vue" }] });

    const rows = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it("replaceLanguages rejects an unrecognised language code", async () => {
    const userId = await createUser();
    await expect(
      service.replaceLanguages(userId, [{ code: "xx", proficiency: "native" }]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("replaceLanguages accepts a known code", async () => {
    const userId = await createUser();
    await sql`INSERT INTO languages (code, name) VALUES ('en', 'English') ON CONFLICT DO NOTHING`;

    await service.replaceLanguages(userId, [{ code: "en", proficiency: "native" }]);
    const rows = await db.select().from(userLanguages).where(eq(userLanguages.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proficiency).toBe("native");
  });
});
