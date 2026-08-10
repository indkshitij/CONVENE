import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InboundFiltersService } from "./inbound-filters.service";

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

// P8.2's own testing requirement: "Assert a filtered inbound intent is
// rejected at send time with the §10.6 error." POST /connections/requests
// doesn't exist yet (Phase 14) — this exercises checkInbound() directly,
// the predicate that endpoint will call once it's built. Run against a
// real Postgres (see otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("InboundFiltersService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: InboundFiltersService;

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
    await sql`DELETE FROM inbound_intent_filters`;
    await sql`DELETE FROM users`;
    const postgresService = { db } as never;
    service = new InboundFiltersService(postgresService);
  });

  async function createUser(): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"inbound-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Inbound Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    return (user as { id: string }).id;
  }

  it("allows everything when no filter row exists", async () => {
    const recipient = await createUser();
    const result = await service.checkInbound(recipient, {
      intentType: "hiring",
      yearsExperience: 0,
      industryId: null,
      verificationLevel: 0,
    });
    expect(result).toEqual({ allowed: true });
  });

  it("§10.6.5 / BR-INT-07: rejects an intent not in the accepted list with 403 INTENT_FILTERED and the exact copy", async () => {
    const recipient = await createUser();
    await service.updateFilters(recipient, { accepted_intents: ["need_mentor", "learning"] });

    const result = await service.checkInbound(recipient, {
      intentType: "hiring",
      yearsExperience: 0,
      industryId: null,
      verificationLevel: 0,
    });
    expect(result).toEqual({
      allowed: false,
      reason: "INTENT_FILTERED",
      message: "This person isn't accepting requests for that intent",
    });
  });

  it("allows an intent that is in the accepted list", async () => {
    const recipient = await createUser();
    await service.updateFilters(recipient, { accepted_intents: ["need_mentor", "learning"] });

    const result = await service.checkInbound(recipient, {
      intentType: "need_mentor",
      yearsExperience: 0,
      industryId: null,
      verificationLevel: 0,
    });
    expect(result.allowed).toBe(true);
  });

  it("rejects a sender below the recipient's minimum experience threshold", async () => {
    const recipient = await createUser();
    await service.updateFilters(recipient, { min_experience_years: 5 });

    const result = await service.checkInbound(recipient, {
      intentType: "coffee_chat",
      yearsExperience: 2,
      industryId: null,
      verificationLevel: 0,
    });
    expect(result.allowed).toBe(false);
  });

  it("rejects an unverified sender when verified_only is set", async () => {
    const recipient = await createUser();
    await service.updateFilters(recipient, { verified_only: true });

    const unverified = await service.checkInbound(recipient, {
      intentType: "coffee_chat",
      yearsExperience: 0,
      industryId: null,
      verificationLevel: 0,
    });
    expect(unverified.allowed).toBe(false);

    const verified = await service.checkInbound(recipient, {
      intentType: "coffee_chat",
      yearsExperience: 0,
      industryId: null,
      verificationLevel: 1,
    });
    expect(verified.allowed).toBe(true);
  });

  it("rejects a sender outside the industry restriction, including a sender with no industry at all", async () => {
    const recipient = await createUser();
    await service.updateFilters(recipient, { industries: [3, 7] });

    const wrongIndustry = await service.checkInbound(recipient, {
      intentType: "coffee_chat",
      yearsExperience: 0,
      industryId: 9,
      verificationLevel: 0,
    });
    expect(wrongIndustry.allowed).toBe(false);

    const noIndustry = await service.checkInbound(recipient, {
      intentType: "coffee_chat",
      yearsExperience: 0,
      industryId: null,
      verificationLevel: 0,
    });
    expect(noIndustry.allowed).toBe(false);

    const rightIndustry = await service.checkInbound(recipient, {
      intentType: "coffee_chat",
      yearsExperience: 0,
      industryId: 7,
      verificationLevel: 0,
    });
    expect(rightIndustry.allowed).toBe(true);
  });

  it("getFilters round-trips exactly what updateFilters stored", async () => {
    const recipient = await createUser();
    await service.updateFilters(recipient, {
      accepted_intents: ["hiring"],
      min_experience_years: 2,
      max_experience_years: 10,
      industries: [1, 2],
      verified_only: true,
      max_inbound_per_day: 8,
    });

    const filters = await service.getFilters(recipient);
    expect(filters.accepted_intents).toEqual(["hiring"]);
    expect(filters.min_experience_years).toBe("2.0");
    expect(filters.max_experience_years).toBe("10.0");
    expect(filters.industries).toEqual([1, 2]);
    expect(filters.verified_only).toBe(true);
    expect(filters.max_inbound_per_day).toBe(8);
  });
});
