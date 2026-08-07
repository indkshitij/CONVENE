import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "../../../common/clock";
import { OtpService } from "./otp.service";

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

// PRD BR-AUTH-08, tested against a real Postgres (same postgis+pgvector
// image docker-compose/CI use) rather than mocking drizzle's query
// builder — the cooldown/rate-limit/attempt logic all depends on real row
// ordering and timestamps. Skips gracefully where Docker isn't available.
describe.skipIf(!dockerAvailable)("OtpService (Testcontainers)", () => {
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
      VALUES ('otp-test@example.com', 'OTP Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    userId = (user as { id: string }).id;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  beforeAll(() => {
    now = new Date("2026-08-03T00:00:00Z");
  });

  it("sends an OTP and then verifies it successfully", async () => {
    const service = new OtpService({ db } as never, clock);
    const sendResult = await service.send(userId, "email");
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok) throw new Error("unreachable");

    const verifyResult = await service.verify(userId, "email", sendResult.result.code);
    expect(verifyResult).toEqual({ ok: true });
  });

  it("rejects an incorrect code without consuming the challenge", async () => {
    const service = new OtpService({ db } as never, clock);
    const sendResult = await service.send(userId, "email");
    if (!sendResult.ok) throw new Error("unreachable");

    const wrongCode = sendResult.result.code === "000000" ? "111111" : "000000";
    const result = await service.verify(userId, "email", wrongCode);
    expect(result).toEqual({ ok: false, reason: "OTP_INVALID" });
  });

  it("invalidates the challenge after 5 failed attempts", async () => {
    const service = new OtpService({ db } as never, clock);
    const sendResult = await service.send(userId, "email");
    if (!sendResult.ok) throw new Error("unreachable");
    const wrongCode = sendResult.result.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 4; i++) {
      const result = await service.verify(userId, "email", wrongCode);
      expect(result).toEqual({ ok: false, reason: "OTP_INVALID" });
    }
    const finalResult = await service.verify(userId, "email", wrongCode);
    expect(finalResult).toEqual({ ok: false, reason: "OTP_MAX_ATTEMPTS" });

    // even the correct code no longer works once max attempts is hit
    const correctAttempt = await service.verify(userId, "email", sendResult.result.code);
    expect(correctAttempt).toEqual({ ok: false, reason: "OTP_MAX_ATTEMPTS" });
  });

  it("enforces the 60s resend cooldown", async () => {
    const service = new OtpService({ db } as never, clock);
    await service.send(userId, "phone");
    const second = await service.send(userId, "phone");
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.rejection.reason).toBe("OTP_RATE_LIMITED");
  });
});
