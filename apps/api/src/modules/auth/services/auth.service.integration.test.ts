import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { users } from "@convene/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../../common/clock";
import type { EmailMessage, EmailTransport } from "../../notifications/email.service";
import { EmailService } from "../../notifications/email.service";
import { LoginLockoutService } from "./login-lockout.service";
import { JwksService, LocalFileKeyProvider } from "./jwks.service";
import { OtpService } from "./otp.service";
import { HTTP_FETCHER, PasswordService, type HttpFetcher } from "./password.service";
import { TokenService } from "./token.service";
import { VerificationService } from "./verification.service";
import { AuthService, type RegisterInput } from "./auth.service";

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

class FakeRedis {
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

// PRD §10.1.9's Gherkin acceptance criteria, run against a real Postgres
// (see otp.service.integration.test.ts for why). This phase (P5.2) only
// covers endpoints 1/2/6/7 — the refresh-rotation-and-reuse scenario is
// P5.3's, and the discovery-gating/onboarding-activation scenarios depend
// on modules (discovery, availability) that don't exist yet; both are
// exercised by their own owning phase's tests instead of faked here.
describe.skipIf(!dockerAvailable)(
  "AuthService — §10.1.9 acceptance criteria (Testcontainers)",
  () => {
    let container: StartedTestContainer;
    let sql: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    let authService: AuthService;
    let emailTransport: RecordingEmailTransport;
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
      await sql`DELETE FROM otp_challenges`;
      await sql`DELETE FROM refresh_tokens`;
      await sql`DELETE FROM profiles`;
      await sql`DELETE FROM users`;

      now = new Date("2026-08-03T00:00:00Z");
      emailTransport = new RecordingEmailTransport();

      const postgresService = { db } as never;
      const neverBreached: HttpFetcher = async () => ({ ok: false, text: async () => "" });
      const passwordService = new PasswordService(neverBreached);
      const jwksDir = `/tmp/convene-auth-service-test-jwks-${Math.random().toString(36).slice(2)}.json`;
      const jwks = new JwksService(new LocalFileKeyProvider(jwksDir));
      const tokenService = new TokenService(jwks);
      const otpService = new OtpService(postgresService, clock);
      const verificationService = new VerificationService(postgresService, clock);
      const emailService = new EmailService(emailTransport);
      const loginLockout = new LoginLockoutService({ client: new FakeRedis() } as never, clock);

      authService = new AuthService(
        postgresService,
        passwordService,
        tokenService,
        otpService,
        verificationService,
        emailService,
        loginLockout,
        clock,
      );
    });

    function registerInput(overrides: Partial<RegisterInput> = {}): RegisterInput {
      return {
        method: "email",
        email: "ananya@example.com",
        password: "correct-horse-9",
        full_name: "Ananya Rao",
        date_of_birth: "2003-04-11",
        accepted_terms_version: "2026-06-01",
        ...overrides,
      };
    }

    // Gherkin: "Successful email registration"
    it("registers a new user with a 900s access token, dispatches a verification email, and starts onboarding at step 1", async () => {
      const result = await authService.register(registerInput());

      expect(result.tokens.expires_in).toBe(900);
      expect(result.tokens.token_type).toBe("Bearer");
      expect(result.user.onboarding_step).toBe(1);
      expect(result.user.email_verified).toBe(false);
      expect(result.user.status).toBe("pending_verification");
      expect(emailTransport.sent).toHaveLength(1);
      expect(emailTransport.sent[0]?.to).toBe("ananya@example.com");

      const [row] = await db.select().from(users).where(eq(users.id, result.user.id));
      expect(row).toBeDefined();
    });

    // Gherkin: "Underage registration is blocked"
    it("blocks a registrant under 18 without creating a user or sending an email", async () => {
      const seventeenYearOldDob = "2009-01-01"; // age 17 as of the fixed clock (2026-08-03)

      await expect(
        authService.register(registerInput({ date_of_birth: seventeenYearOldDob })),
      ).rejects.toMatchObject({ code: "AGE_RESTRICTED", httpStatus: 403 });

      const rows = await db.select().from(users);
      expect(rows).toHaveLength(0);
      expect(emailTransport.sent).toHaveLength(0);
    });

    // BR-AUTH-01: email is globally unique; a verified conflict is revealed.
    it("rejects registration for an email that already belongs to a verified account", async () => {
      const first = await authService.register(registerInput());
      await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, first.user.id));

      await expect(
        authService.register(registerInput({ full_name: "Someone Else" })),
      ).rejects.toMatchObject({
        code: "EMAIL_ALREADY_EXISTS",
        httpStatus: 409,
      });
    });

    // §10.1.7 error table: "Never reveal whether an unverified account
    // exists — return 201 with a resend instead." The critical security
    // property: the caller must not receive a session usable against the
    // real (existing) account.
    it("responds 201 with a resend for an unverified email conflict, without granting access to the real account", async () => {
      const first = await authService.register(registerInput());
      emailTransport.sent.length = 0;

      const second = await authService.register(
        registerInput({ full_name: "Attacker Supplied Name" }),
      );

      expect(second.user.status).toBe("pending_verification");
      expect(second.user.email_verified).toBe(false);
      expect(second.tokens.expires_in).toBe(900);
      // A resend was dispatched to the real account's email...
      expect(emailTransport.sent).toHaveLength(1);
      // ...but the response's id/tokens are not the real account's.
      expect(second.user.id).not.toBe(first.user.id);

      const rows = await db.select().from(users);
      expect(rows).toHaveLength(1); // no duplicate user row was created
    });

    // BR-AUTH-07: 5 failed attempts locks the (identifier, ip) pair.
    it("locks out login after 5 failed password attempts", async () => {
      const registered = await authService.register(registerInput());
      await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, registered.user.id));

      for (let i = 0; i < 5; i++) {
        await expect(
          authService.login(
            { email: "ananya@example.com", password: "wrong-password" },
            "1.2.3.4",
            "device-1",
          ),
        ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
      }

      await expect(
        authService.login(
          { email: "ananya@example.com", password: "correct-horse-9" },
          "1.2.3.4",
          "device-1",
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED", httpStatus: 423 });
    });

    // Enumeration defence: a nonexistent account and a wrong password on a
    // real account must be indistinguishable in status/code.
    it("returns the same INVALID_CREDENTIALS outcome for a nonexistent account and a wrong password", async () => {
      await authService.register(registerInput());

      const nonexistent = authService
        .login({ email: "nobody@example.com", password: "whatever-9" }, "9.9.9.9", "device-2")
        .catch((error: unknown) => error);
      const wrongPassword = authService
        .login({ email: "ananya@example.com", password: "whatever-9" }, "9.9.9.8", "device-2")
        .catch((error: unknown) => error);

      const [nonexistentError, wrongPasswordError] = await Promise.all([
        nonexistent,
        wrongPassword,
      ]);

      expect((nonexistentError as { code: string }).code).toBe("INVALID_CREDENTIALS");
      expect((wrongPasswordError as { code: string }).code).toBe("INVALID_CREDENTIALS");
      expect((nonexistentError as { httpStatus: number }).httpStatus).toBe(
        (wrongPasswordError as { httpStatus: number }).httpStatus,
      );
    });

    // P5.2's own explicit testing requirement: "A test asserting that
    // registering an existing email and a fresh email produce responses
    // indistinguishable in body, status and (within tolerance) timing."
    it("produces body-, status-, and timing-indistinguishable responses for a fresh email vs. an existing unverified one", async () => {
      await authService.register(registerInput({ email: "existing@example.com" }));

      const freshStart = performance.now();
      const freshResult = await authService.register(registerInput({ email: "fresh@example.com" }));
      const freshDurationMs = performance.now() - freshStart;

      const conflictStart = performance.now();
      const conflictResult = await authService.register(
        registerInput({ email: "existing@example.com", full_name: "Different Name" }),
      );
      const conflictDurationMs = performance.now() - conflictStart;

      expect(Object.keys(freshResult.user).sort()).toEqual(Object.keys(conflictResult.user).sort());
      expect(Object.keys(freshResult.tokens).sort()).toEqual(
        Object.keys(conflictResult.tokens).sort(),
      );
      expect(freshResult.user.onboarding_step).toBe(conflictResult.user.onboarding_step);
      expect(freshResult.user.email_verified).toBe(conflictResult.user.email_verified);
      expect(freshResult.user.status).toBe(conflictResult.user.status);
      expect(freshResult.tokens.expires_in).toBe(conflictResult.tokens.expires_in);
      expect(freshResult.tokens.token_type).toBe(conflictResult.tokens.token_type);

      // argon2id (a deliberately expensive, ~constant-time hash) dominates
      // this method's latency in both branches, so the residual gap between
      // "insert 2 rows" and "send an email" is a small fraction of total
      // time — generous tolerance since CI/sandbox timing jitter is real.
      const slower = Math.max(freshDurationMs, conflictDurationMs);
      const faster = Math.min(freshDurationMs, conflictDurationMs);
      expect(slower - faster).toBeLessThan(Math.max(50, slower * 0.5));
    });

    it("logs in successfully with correct credentials and returns access + refresh tokens", async () => {
      await authService.register(registerInput());

      const result = await authService.login(
        { email: "ananya@example.com", password: "correct-horse-9" },
        "1.2.3.4",
        "device-1",
      );

      expect(result.tokens.access_token).toEqual(expect.any(String));
      expect(result.tokens.refresh_token).toEqual(expect.any(String));
      expect(result.user.email).toBe("ananya@example.com");
    });
  },
);
