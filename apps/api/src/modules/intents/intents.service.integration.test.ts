import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../common/clock";
import { IntentsService } from "./intents.service";

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

// §10.4.8's Gherkin scenarios reachable from this phase's own endpoints
// (Plan limits, Prerequisites, the archived-transition half of Intent
// expiry) — the other three (complementary ranking, intent-match floor at
// send time, inbound filters) belong to matching/connections modules not
// yet built (P8.2/P12/P13/P14), run against a real Postgres (see
// otp.service.integration.test.ts for why the partial unique indexes'
// enforcement needs a real DB rather than a mocked query builder).
describe.skipIf(!dockerAvailable)("IntentsService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: IntentsService;
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
    await sql`DELETE FROM user_intents`;
    await sql`DELETE FROM users`;

    now = new Date("2026-08-08T00:00:00Z");
    const postgresService = { db } as never;
    service = new IntentsService(postgresService, clock);
  });

  async function createUser(
    overrides: { companyName?: string; verificationLevel?: number; yearsExperience?: string } = {},
  ): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"intent-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Intent Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`
      INSERT INTO profiles (user_id, company_name, verification_level, years_experience)
      VALUES (${userId}, ${overrides.companyName ?? null}, ${overrides.verificationLevel ?? 0}, ${overrides.yearsExperience ?? "0"})
    `;
    return userId;
  }

  it("§10.4.8 'Plan limits': the 4th intent on the free plan is rejected with 402 PLAN_LIMIT_REACHED", async () => {
    const userId = await createUser();
    await service.createIntent(userId, "free", { type: "coffee_chat", expires_in_days: 30 });
    await service.createIntent(userId, "free", { type: "learning", expires_in_days: 30 });
    await service.createIntent(userId, "free", {
      type: "business_networking",
      expires_in_days: 30,
    });

    await expect(
      service.createIntent(userId, "free", { type: "partnerships", expires_in_days: 30 }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED", httpStatus: 402 });
  });

  it("premium plan allows up to 8 active intents", async () => {
    const userId = await createUser();
    const types = [
      "coffee_chat",
      "learning",
      "business_networking",
      "partnerships",
      "ai_collaboration",
      "startup_discussion",
      "looking_for_job",
      "freelancer",
    ] as const;
    for (const type of types) {
      await service.createIntent(userId, "premium", { type, expires_in_days: 30 });
    }
    const active = await service.listIntents(userId, false);
    expect(active).toHaveLength(8);
  });

  it("§10.4.8 'Prerequisites': L2 verification adding investment_discussion (needs L4) returns 422 with unmet ['verification_level_4']", async () => {
    const userId = await createUser({ verificationLevel: 2 });
    await expect(
      service.createIntent(userId, "free", { type: "investment_discussion", expires_in_days: 30 }),
    ).rejects.toMatchObject({
      code: "INTENT_PREREQUISITE_UNMET",
      httpStatus: 422,
      details: { unmet: ["verification_level_4"] },
    });
  });

  it("hiring succeeds once a company name is on the profile", async () => {
    const userId = await createUser({ companyName: "Xenon Labs" });
    const result = await service.createIntent(userId, "free", {
      type: "hiring",
      expires_in_days: 30,
    });
    expect(result.intent.type).toBe("hiring");
  });

  it("rejects a duplicate active type with 409 DUPLICATE_INTENT", async () => {
    const userId = await createUser();
    await service.createIntent(userId, "free", { type: "coffee_chat", expires_in_days: 30 });
    await expect(
      service.createIntent(userId, "free", { type: "coffee_chat", expires_in_days: 14 }),
    ).rejects.toMatchObject({ code: "DUPLICATE_INTENT", httpStatus: 409 });
  });

  it("BR-INT-03: the first intent is always primary regardless of the request body", async () => {
    const userId = await createUser();
    const result = await service.createIntent(userId, "free", {
      type: "coffee_chat",
      expires_in_days: 30,
      is_primary: false,
    });
    expect(result.intent.is_primary).toBe(true);
  });

  it("BR-INT-03: a second intent doesn't disturb the first's primary status unless is_primary is requested", async () => {
    const userId = await createUser();
    await service.createIntent(userId, "free", { type: "coffee_chat", expires_in_days: 30 });
    const second = await service.createIntent(userId, "free", {
      type: "learning",
      expires_in_days: 30,
    });
    expect(second.intent.is_primary).toBe(false);

    const active = await service.listIntents(userId, false);
    expect(active.filter((i) => i.is_primary)).toHaveLength(1);
  });

  it("BR-INT-03: setPrimary swaps the primary flag exclusively", async () => {
    const userId = await createUser();
    const first = await service.createIntent(userId, "free", {
      type: "coffee_chat",
      expires_in_days: 30,
    });
    const second = await service.createIntent(userId, "free", {
      type: "learning",
      expires_in_days: 30,
    });

    await service.setPrimary(userId, second.intent.id);
    const active = await service.listIntents(userId, false);
    expect(active.find((i) => i.id === second.intent.id)?.is_primary).toBe(true);
    expect(active.find((i) => i.id === first.intent.id)?.is_primary).toBe(false);
  });

  it("BR-INT-03: deleting the primary intent auto-promotes a remaining active one", async () => {
    const userId = await createUser();
    const first = await service.createIntent(userId, "free", {
      type: "coffee_chat",
      expires_in_days: 30,
    });
    await service.createIntent(userId, "free", { type: "learning", expires_in_days: 30 });

    await service.deleteIntent(userId, first.intent.id);
    const active = await service.listIntents(userId, false);
    expect(active).toHaveLength(1);
    expect(active[0]?.is_primary).toBe(true);
  });

  it("§10.4.8 'Intent expiry' (archive half): an expired active intent is lazily archived on the next read and excluded from the active listing", async () => {
    const userId = await createUser();
    await service.createIntent(userId, "free", { type: "coffee_chat", expires_in_days: 7 });

    now = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000); // 8 days later, past the 7-day expiry
    const active = await service.listIntents(userId, false);
    expect(active).toHaveLength(0);

    const withArchived = await service.listIntents(userId, true);
    expect(withArchived).toHaveLength(1);
    expect(withArchived[0]?.status).toBe("archived");
  });

  it("renewIntent extends expiry and increments renewed_count, but only for an active intent", async () => {
    const userId = await createUser();
    const created = await service.createIntent(userId, "free", {
      type: "coffee_chat",
      expires_in_days: 7,
    });

    const renewed = await service.renewIntent(userId, created.intent.id, { expires_in_days: 30 });
    expect(renewed.renewed_count).toBe(1);
    expect(new Date(renewed.expires_at).getTime()).toBeGreaterThan(
      new Date(created.intent.expires_at).getTime(),
    );
  });

  it("ownership: user A cannot update or delete user B's intent", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const created = await service.createIntent(userA, "free", {
      type: "coffee_chat",
      expires_in_days: 30,
    });

    await expect(
      service.updateIntent(userB, created.intent.id, { is_paused: true }),
    ).rejects.toMatchObject({ code: "INTENT_NOT_FOUND", httpStatus: 404 });
    await expect(service.deleteIntent(userB, created.intent.id)).rejects.toMatchObject({
      code: "INTENT_NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("BR-INT-08: is_paused preserves the expiry clock rather than resetting it", async () => {
    const userId = await createUser();
    const created = await service.createIntent(userId, "free", {
      type: "coffee_chat",
      expires_in_days: 30,
    });
    const updated = await service.updateIntent(userId, created.intent.id, { is_paused: true });
    expect(updated.expires_at).toBe(created.intent.expires_at);
    expect(updated.is_paused).toBe(true);
  });
});
