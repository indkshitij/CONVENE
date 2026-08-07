import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { refreshTokens, users } from "@convene/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../../common/clock";
import type { EmailMessage, EmailTransport } from "../../notifications/email.service";
import { EmailService } from "../../notifications/email.service";
import { AccountDeletionService } from "./account-deletion.service";
import { JwksService, LocalFileKeyProvider } from "./jwks.service";
import { RefreshService } from "./refresh.service";
import { TokenService } from "./token.service";

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

class RecordingEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

// PRD §10.1.7 endpoint 11 / BR-AUTH-10 / §20.6, run against a real
// Postgres (see otp.service.integration.test.ts for why). The P5.5
// prompt's own testing requirement: "Assert a deleted account disappears
// from every discovery surface immediately, not at purge time" — there is
// no discovery module yet to query against, so this asserts the
// underlying mechanism any future discovery query would filter on:
// users.status flips to 'deleted' synchronously within requestDeletion()
// itself, not deferred to a background job.
describe.skipIf(!dockerAvailable)("AccountDeletionService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: AccountDeletionService;
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
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await sql`DELETE FROM refresh_tokens`;
    await sql`DELETE FROM profiles`;
    await sql`DELETE FROM users`;

    now = new Date("2026-08-03T00:00:00Z");

    const postgresService = { db } as never;
    const jwks = new JwksService(
      new LocalFileKeyProvider(
        `/tmp/convene-deletion-test-jwks-${Math.random().toString(36).slice(2)}.json`,
      ),
    );
    const tokenService = new TokenService(jwks);
    const emailService = new EmailService(new RecordingEmailTransport());
    const authContextService = { invalidate: async () => undefined } as never;
    const refreshService = new RefreshService(
      postgresService,
      tokenService,
      emailService,
      authContextService,
      clock,
    );
    service = new AccountDeletionService(postgresService, refreshService, clock);

    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version, status)
      VALUES (${"deletion-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Deletion Test', '1990-01-01', 'v1', 'active')
      RETURNING id
    `;
    userId = (user as { id: string }).id;

    await db.insert(refreshTokens).values({
      userId,
      familyId: crypto.randomUUID(),
      tokenHash: crypto.randomUUID(),
      deviceFingerprint: "device-a",
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
  });

  it("requestDeletion immediately marks the account deleted, sets purge_at 30 days out, and revokes every session", async () => {
    const result = await service.requestDeletion(userId);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.status).toBe("deleted");
    expect(user!.deletionRequestedAt).not.toBeNull();
    expect(user!.purgeAt?.getTime()).toBe(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(result.purgeScheduledAt.getTime()).toBe(user!.purgeAt!.getTime());

    const sessions = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it("cancelDeletion restores full access during the grace window", async () => {
    await service.requestDeletion(userId);
    await service.cancelDeletion(userId);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.status).toBe("active");
    expect(user!.deletionRequestedAt).toBeNull();
    expect(user!.purgeAt).toBeNull();
  });

  it("cancelDeletion is a no-op for an account that never requested deletion (doesn't reactivate a suspended account)", async () => {
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, userId));

    await service.cancelDeletion(userId);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.status).toBe("suspended");
  });
});
