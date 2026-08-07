import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authIdentities, users } from "@convene/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../../common/clock";
import { JwksService, LocalFileKeyProvider } from "./jwks.service";
import type { OAuthExchangeParams, OAuthProfile, OAuthProvider } from "./oauth-provider";
import { OAuthService } from "./oauth.service";
import { HTTP_FETCHER, PasswordService, type HttpFetcher } from "./password.service";
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

class FakeOAuthProvider implements OAuthProvider {
  constructor(private readonly profile: OAuthProfile) {}
  buildAuthorizeUrl(): string {
    return "https://fake-provider.example.com/authorize";
  }
  async exchangeCode(_params: OAuthExchangeParams): Promise<OAuthProfile> {
    return this.profile;
  }
}

// PRD §10.1.7 endpoint 10 + §13 F1, run against a real Postgres (see
// otp.service.integration.test.ts for why) with a fake OAuthProvider (no
// real network call to Google/LinkedIn — that boundary is exactly what
// the OAuthProvider abstraction exists to let tests substitute).
describe.skipIf(!dockerAvailable)("OAuthService (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
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

  function makeService(profile: OAuthProfile) {
    const postgresService = { db } as never;
    const jwks = new JwksService(
      new LocalFileKeyProvider(
        `/tmp/convene-oauth-test-jwks-${Math.random().toString(36).slice(2)}.json`,
      ),
    );
    const tokenService = new TokenService(jwks);
    const neverBreached: HttpFetcher = async () => ({ ok: false, text: async () => "" });
    const passwordService = new PasswordService(neverBreached);
    const emailService = { sendSecurityAlertEmail: async () => undefined } as never;
    const authContextService = { invalidate: async () => undefined } as never;
    const refreshService = new RefreshService(
      postgresService,
      tokenService,
      emailService,
      authContextService,
      clock,
    );
    const redis = { client: new FakeRedisClient() };
    const provider = new FakeOAuthProvider(profile);

    const service = new OAuthService(
      postgresService,
      redis as never,
      provider,
      provider,
      passwordService,
      refreshService,
      clock,
    );
    return { service, passwordService };
  }

  beforeEach(async () => {
    now = new Date("2026-08-03T00:00:00Z");
    await sql`DELETE FROM auth_identities`;
    await sql`DELETE FROM refresh_tokens`;
    await sql`DELETE FROM profiles`;
    await sql`DELETE FROM users`;
  });

  it("creates a brand-new user when no identity or email matches", async () => {
    const { service } = makeService({
      providerUid: "google-uid-1",
      email: "new-oauth-user@example.com",
      emailVerified: true,
      fullName: "New OAuth User",
    });

    const start = await service.start("google", "https://app.example.com/callback");
    const result = await service.callback(
      "google",
      "auth-code",
      start.state,
      "device-a",
      "2026-06-01",
    );

    expect(result.is_new_user).toBe(true);
    expect(result.link_confirmation_required).toBe(false);
    expect(result.user?.email).toBe("new-oauth-user@example.com");
    expect(result.tokens?.access_token).toEqual(expect.any(String));

    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.providerUid, "google-uid-1"));
    expect(identity?.userId).toBe(result.user!.id);
  });

  it("logs in directly when the auth_identity already exists", async () => {
    const { service } = makeService({
      providerUid: "google-uid-2",
      email: "returning-oauth-user@example.com",
      emailVerified: true,
      fullName: "Returning User",
    });

    const start1 = await service.start("google", "https://app.example.com/callback");
    const first = await service.callback(
      "google",
      "auth-code",
      start1.state,
      "device-a",
      "2026-06-01",
    );

    const start2 = await service.start("google", "https://app.example.com/callback");
    const second = await service.callback(
      "google",
      "auth-code",
      start2.state,
      "device-b",
      "2026-06-01",
    );

    expect(second.is_new_user).toBe(false);
    expect(second.user?.id).toBe(first.user?.id);
  });

  it("requires explicit link confirmation when the email matches an existing account, without logging the caller in", async () => {
    const [existingUser] = await db
      .insert(users)
      .values({
        email: "already-registered@example.com",
        fullName: "Already Registered",
        dateOfBirth: "1990-01-01",
        termsVersion: "v1",
        passwordHash: await new PasswordService(async () => ({
          ok: false,
          text: async () => "",
        })).hash("correct-horse-9"),
        emailVerifiedAt: now,
      })
      .returning();

    const { service } = makeService({
      providerUid: "google-uid-3",
      email: "already-registered@example.com",
      emailVerified: true,
      fullName: "OAuth Name",
    });

    const start = await service.start("google", "https://app.example.com/callback");
    const result = await service.callback(
      "google",
      "auth-code",
      start.state,
      "device-a",
      "2026-06-01",
    );

    expect(result.link_confirmation_required).toBe(true);
    expect(result.tokens).toBeNull();
    expect(result.user).toBeNull();
    expect(result.link_token).toEqual(expect.any(String));

    const identities = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, existingUser!.id));
    expect(identities).toHaveLength(0); // not linked yet — confirmation required first
  });

  it("confirmLink completes the linking after the correct password is supplied", async () => {
    const rawPassword = "correct-horse-9";
    const passwordService = new PasswordService(async () => ({ ok: false, text: async () => "" }));
    const [existingUser] = await db
      .insert(users)
      .values({
        email: "link-me@example.com",
        fullName: "Link Me",
        dateOfBirth: "1990-01-01",
        termsVersion: "v1",
        passwordHash: await passwordService.hash(rawPassword),
        emailVerifiedAt: now,
      })
      .returning();

    const { service } = makeService({
      providerUid: "google-uid-4",
      email: "link-me@example.com",
      emailVerified: true,
      fullName: "OAuth Name",
    });

    const start = await service.start("google", "https://app.example.com/callback");
    const callbackResult = await service.callback(
      "google",
      "auth-code",
      start.state,
      "device-a",
      "2026-06-01",
    );

    const confirmed = await service.confirmLink(
      callbackResult.link_token!,
      rawPassword,
      "device-a",
    );
    expect(confirmed.user?.id).toBe(existingUser!.id);
    expect(confirmed.tokens?.access_token).toEqual(expect.any(String));

    const identities = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, existingUser!.id));
    expect(identities).toHaveLength(1);
    expect(identities[0]?.providerUid).toBe("google-uid-4");
  });

  it("confirmLink rejects an incorrect password without linking", async () => {
    const passwordService = new PasswordService(async () => ({ ok: false, text: async () => "" }));
    const [existingUser] = await db
      .insert(users)
      .values({
        email: "wrong-password-link@example.com",
        fullName: "Wrong Password",
        dateOfBirth: "1990-01-01",
        termsVersion: "v1",
        passwordHash: await passwordService.hash("correct-horse-9"),
        emailVerifiedAt: now,
      })
      .returning();

    const { service } = makeService({
      providerUid: "google-uid-5",
      email: "wrong-password-link@example.com",
      emailVerified: true,
      fullName: "OAuth Name",
    });

    const start = await service.start("google", "https://app.example.com/callback");
    const callbackResult = await service.callback(
      "google",
      "auth-code",
      start.state,
      "device-a",
      "2026-06-01",
    );

    await expect(
      service.confirmLink(callbackResult.link_token!, "totally-wrong-password", "device-a"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    const identities = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, existingUser!.id));
    expect(identities).toHaveLength(0);
  });

  it("rejects a callback with an unknown or expired state", async () => {
    const { service } = makeService({
      providerUid: "google-uid-6",
      email: null,
      emailVerified: false,
      fullName: null,
    });

    await expect(
      service.callback("google", "auth-code", "made-up-state", "device-a", "2026-06-01"),
    ).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
  });
});
