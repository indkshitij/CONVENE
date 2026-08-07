import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "../../../common/clock";
import { VerificationService } from "./verification.service";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

const migrationsDir = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "db",
  "migrations",
);
const dockerContextDir = join(__dirname, "..", "..", "..", "..", "..", "..", "docker", "postgres");

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

// PRD §10.1.7's email-verification endpoint, tested against a real
// Postgres (see otp.service.integration.test.ts for why). Skips
// gracefully where Docker isn't available.
describe.skipIf(!dockerAvailable)("VerificationService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let userId: string;
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
    sql = postgres(`postgres://postgres:test@${host}:${port}/postgres`, { max: 1 });
    db = drizzle(sql, { schema });

    for (const migration of MIGRATIONS) {
      const upSql = readFileSync(join(migrationsDir, `${migration}.sql`), "utf8");
      await sql.unsafe(upSql);
    }

    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES ('verify-test@example.com', 'Verify Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    userId = (user as { id: string }).id;
    now = new Date("2026-08-03T00:00:00Z");
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  it("creates and consumes a verification token exactly once", async () => {
    const service = new VerificationService({ db } as never, clock);
    const created = await service.createEmailVerificationToken(userId);

    const firstConsume = await service.consumeEmailVerificationToken(created.token);
    expect(firstConsume).toEqual({ ok: true, userId });

    const secondConsume = await service.consumeEmailVerificationToken(created.token);
    expect(secondConsume).toEqual({ ok: false, reason: "TOKEN_USED" });
  });

  it("rejects an unknown token", async () => {
    const service = new VerificationService({ db } as never, clock);
    const result = await service.consumeEmailVerificationToken("not-a-real-token");
    expect(result).toEqual({ ok: false, reason: "TOKEN_INVALID" });
  });

  it("rejects an expired token", async () => {
    const service = new VerificationService({ db } as never, clock);
    const created = await service.createEmailVerificationToken(userId);

    const future = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const futureClockService = new VerificationService({ db } as never, { now: () => future });
    const result = await futureClockService.consumeEmailVerificationToken(created.token);
    expect(result).toEqual({ ok: false, reason: "TOKEN_EXPIRED" });
  });
});
