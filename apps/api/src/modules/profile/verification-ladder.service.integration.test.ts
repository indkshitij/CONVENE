import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../common/clock";
import {
  EmailService,
  type EmailMessage,
  type EmailTransport,
} from "../notifications/email.service";
import { VerificationService } from "../auth/services/verification.service";
import { VerificationLadderService } from "./verification-ladder.service";

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

class CapturingEmailTransport implements EmailTransport {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

// PRD §10.2.5 L3/L4 (P7.3), run against a real Postgres (see
// otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("VerificationLadderService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: VerificationLadderService;
  let transport: CapturingEmailTransport;
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
    await sql`DELETE FROM identity_verifications`;
    await sql`DELETE FROM verification_tokens`;
    await sql`DELETE FROM users`;

    now = new Date("2026-08-03T00:00:00Z");
    const postgresService = { db } as never;
    transport = new CapturingEmailTransport();
    const verificationService = new VerificationService(postgresService, clock);
    const emailService = new EmailService(transport);
    service = new VerificationLadderService(postgresService, verificationService, emailService);
  });

  async function createUser(companyName: string | null = "Xenon Labs"): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${"vl-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'VL Test', '1990-01-01', 'v1')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id, company_name) VALUES (${userId}, ${companyName})`;
    return userId;
  }

  it("sends a code to a domain matching the profile's company_name and confirming it sets company_verified and level 3", async () => {
    const userId = await createUser("Xenon Labs");
    await service.sendWorkEmailCode(userId, "alex@xenonlabs.com");
    expect(transport.messages).toHaveLength(1);
    const code = transport.messages[0]?.text.match(/\d{6}/)?.[0];
    expect(code).toBeDefined();

    await service.confirmWorkEmailCode(userId, code as string);

    const [profile] =
      await sql`SELECT company_verified, verification_level FROM profiles WHERE user_id = ${userId}`;
    expect((profile as { company_verified: boolean }).company_verified).toBe(true);
    expect((profile as { verification_level: number }).verification_level).toBe(3);
    expect(await service.getLevel(userId)).toBe(3);
  });

  it("rejects a work email whose domain doesn't match the company name, before ever sending a code", async () => {
    const userId = await createUser("Xenon Labs");
    await expect(service.sendWorkEmailCode(userId, "alex@unrelatedco.com")).rejects.toMatchObject({
      code: "WORK_EMAIL_DOMAIN_MISMATCH",
    });
    expect(transport.messages).toHaveLength(0);
  });

  it("rejects confirmation with the wrong code", async () => {
    const userId = await createUser("Xenon Labs");
    await service.sendWorkEmailCode(userId, "alex@xenonlabs.com");
    await expect(service.confirmWorkEmailCode(userId, "000000")).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });

    const [profile] = await sql`SELECT company_verified FROM profiles WHERE user_id = ${userId}`;
    expect((profile as { company_verified: boolean }).company_verified).toBe(false);
  });

  it("submitGovernmentId with an approved result advances to level 4 and stores no PII beyond the provider reference", async () => {
    const userId = await createUser();
    await service.submitGovernmentId(userId, {
      provider: "stripe_identity",
      providerReference: "vs_abc123",
      result: "approved",
    });

    const [profile] = await sql`SELECT verification_level FROM profiles WHERE user_id = ${userId}`;
    expect((profile as { verification_level: number }).verification_level).toBe(4);

    const [row] = await sql`SELECT * FROM identity_verifications WHERE user_id = ${userId}`;
    const columns = Object.keys(row as object).sort();
    expect(columns).toEqual(
      ["created_at", "id", "provider", "provider_reference", "result", "user_id"].sort(),
    );
    expect((row as { provider_reference: string }).provider_reference).toBe("vs_abc123");
  });

  it("submitGovernmentId with a pending result does not advance the level", async () => {
    const userId = await createUser();
    await service.submitGovernmentId(userId, {
      provider: "stripe_identity",
      providerReference: "vs_def456",
      result: "pending",
    });
    expect(await service.getLevel(userId)).toBe(0);
  });

  it("re-derives level from persisted state, so an unrelated later mutation doesn't regress an earlier one", async () => {
    const userId = await createUser("Xenon Labs");
    await service.sendWorkEmailCode(userId, "alex@xenonlabs.com");
    const code = transport.messages[0]?.text.match(/\d{6}/)?.[0] as string;
    await service.confirmWorkEmailCode(userId, code);
    expect(await service.getLevel(userId)).toBe(3);

    await service.submitGovernmentId(userId, {
      provider: "p",
      providerReference: "r1",
      result: "pending",
    });
    expect(await service.getLevel(userId)).toBe(3); // untouched by a non-approved submission

    await service.submitGovernmentId(userId, {
      provider: "p",
      providerReference: "r2",
      result: "approved",
    });
    expect(await service.getLevel(userId)).toBe(4);
  });
});
