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
import { JwksService, LocalFileKeyProvider } from "./jwks.service";
import { PasswordLifecycleService } from "./password-lifecycle.service";
import { HTTP_FETCHER, PasswordService, type HttpFetcher } from "./password.service";
import { RefreshService } from "./refresh.service";
import { TokenService } from "./token.service";
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

class RecordingEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

// PRD §10.1.7 endpoint 8 + BR-AUTH-11, run against a real Postgres (see
// otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)("PasswordLifecycleService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: PasswordLifecycleService;
  let passwordService: PasswordService;
  let refreshService: RefreshService;
  let emailTransport: RecordingEmailTransport;
  let userId: string;
  let userEmail: string;
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
    await sql`DELETE FROM verification_tokens`;
    await sql`DELETE FROM refresh_tokens`;
    await sql`DELETE FROM profiles`;
    await sql`DELETE FROM users`;

    now = new Date("2026-08-03T00:00:00Z");
    emailTransport = new RecordingEmailTransport();

    const postgresService = { db } as never;
    const neverBreached: HttpFetcher = async () => ({ ok: false, text: async () => "" });
    passwordService = new PasswordService(neverBreached);
    const jwks = new JwksService(
      new LocalFileKeyProvider(
        `/tmp/convene-pw-lifecycle-test-jwks-${Math.random().toString(36).slice(2)}.json`,
      ),
    );
    const tokenService = new TokenService(jwks);
    const verificationService = new VerificationService(postgresService, clock);
    const emailService = new EmailService(emailTransport);
    const authContextService = { invalidate: async () => undefined } as never;
    refreshService = new RefreshService(
      postgresService,
      tokenService,
      emailService,
      authContextService,
      clock,
    );
    service = new PasswordLifecycleService(
      postgresService,
      passwordService,
      verificationService,
      emailService,
      refreshService,
      clock,
    );

    userEmail = `pw-lifecycle-test-${Math.random().toString(36).slice(2)}@example.com`;
    const passwordHash = await passwordService.hash("original-password-9");
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version, password_hash)
      VALUES (${userEmail}, 'Password Lifecycle Test', '1990-01-01', 'v1', ${passwordHash})
      RETURNING id
    `;
    userId = (user as { id: string }).id;
  });

  async function seedRefreshToken(): Promise<void> {
    await db.insert(refreshTokens).values({
      userId,
      familyId: crypto.randomUUID(),
      tokenHash: crypto.randomUUID(),
      deviceFingerprint: "device-a",
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
  }

  it("forgotPassword sends a reset email for an existing account", async () => {
    await service.forgotPassword(userEmail);
    expect(emailTransport.sent).toHaveLength(1);
    expect(emailTransport.sent[0]?.to).toBe(userEmail);
  });

  it("forgotPassword is a silent no-op for a nonexistent email (enumeration-safe)", async () => {
    await service.forgotPassword("nobody@example.com");
    expect(emailTransport.sent).toHaveLength(0);
  });

  it("resetPassword changes the password, revokes every refresh token, and sends a security email", async () => {
    await seedRefreshToken();
    await service.forgotPassword(userEmail);
    const resetUrl = emailTransport.sent[0]!.text.match(/token=(\S+)/)![1]!;

    await service.resetPassword(resetUrl, "brand-new-password-9");

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(await passwordService.verify(user!.passwordHash!, "brand-new-password-9")).toBe(true);

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(emailTransport.sent).toHaveLength(2); // reset link + security alert
  });

  it("resetPassword rejects a reused token", async () => {
    await service.forgotPassword(userEmail);
    const resetUrl = emailTransport.sent[0]!.text.match(/token=(\S+)/)![1]!;

    await service.resetPassword(resetUrl, "brand-new-password-9");
    await expect(service.resetPassword(resetUrl, "another-password-9")).rejects.toMatchObject({
      code: "TOKEN_USED",
      httpStatus: 409,
    });
  });

  it("resetPassword rejects an expired token", async () => {
    await service.forgotPassword(userEmail);
    const resetUrl = emailTransport.sent[0]!.text.match(/token=(\S+)/)![1]!;

    now = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2h later, past the 1h TTL
    await expect(service.resetPassword(resetUrl, "brand-new-password-9")).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
      httpStatus: 410,
    });
  });

  it("changePassword rejects an incorrect current password", async () => {
    await expect(
      service.changePassword(userId, "wrong-password", "brand-new-password-9"),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      httpStatus: 401,
    });
  });

  it("changePassword succeeds and revokes every refresh token", async () => {
    await seedRefreshToken();
    await service.changePassword(userId, "original-password-9", "brand-new-password-9");

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(await passwordService.verify(user!.passwordHash!, "brand-new-password-9")).toBe(true);

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });
});
