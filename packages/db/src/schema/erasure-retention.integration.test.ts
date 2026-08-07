import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "./index";
import { conversations, messages } from "./messaging";
import { moderationActions } from "./safety";
import { plans, subscriptions } from "./billing";
import { users } from "./users";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(currentDir, "..", "..", "migrations");
const dockerContextDir = join(currentDir, "..", "..", "..", "..", "docker", "postgres");

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

// PRD §20.6 "Erasure": "Exceptions retained with a documented basis:
// safety records of upheld reports, financial records (7 yrs), and
// messages in the counterparty's copy ... anonymised to 'Deleted user'
// rather than destroyed." migrations/0007_erasure_retention_fks.sql
// changes the FKs that make this true; this test proves it against a real
// Postgres rather than trusting the migration file's comment.
describe.skipIf(!dockerAvailable)("§20.6 erasure retention exceptions (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

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
    // messages is PARTITION BY RANGE with no partitions created by any
    // migration (a later ops phase's job) — a default partition is needed
    // purely so this test can insert a row at all.
    await sql`CREATE TABLE messages_default PARTITION OF messages DEFAULT`;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  it("preserves the subscription (financial record), moderation action (safety record), and message (counterparty copy) when the user is hard-purged", async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: `erasure-test-${Math.random().toString(36).slice(2)}@example.com`,
        fullName: "Erasure Test",
        dateOfBirth: "1990-01-01",
        termsVersion: "v1",
      })
      .returning();
    const [admin] = await db
      .insert(users)
      .values({
        email: `erasure-admin-${Math.random().toString(36).slice(2)}@example.com`,
        fullName: "Admin",
        dateOfBirth: "1990-01-01",
        termsVersion: "v1",
      })
      .returning();

    await db
      .insert(plans)
      .values({ code: "free", name: "Free", entitlements: {} })
      .onConflictDoNothing();
    const [subscription] = await db
      .insert(subscriptions)
      .values({ userId: user!.id, planCode: "free", status: "active", provider: "stripe" })
      .returning();

    const [moderationAction] = await db
      .insert(moderationActions)
      .values({
        targetUserId: user!.id,
        adminId: admin!.id,
        action: "warning",
        policyClause: "clause-1",
        rationale: "test rationale",
      })
      .returning();

    const [conversation] = await db.insert(conversations).values({}).returning();
    const [message] = await db
      .insert(messages)
      .values({
        conversationId: conversation!.id,
        senderId: user!.id,
        clientMsgId: crypto.randomUUID(),
        sequence: 1,
        body: "hello there",
      })
      .returning();

    await db.delete(users).where(eq(users.id, user!.id));

    const [survivedSubscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription!.id));
    expect(survivedSubscription).toBeDefined();
    expect(survivedSubscription!.userId).toBeNull();

    const [survivedModerationAction] = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, moderationAction!.id));
    expect(survivedModerationAction).toBeDefined();
    expect(survivedModerationAction!.targetUserId).toBeNull();

    const [survivedMessage] = await db.select().from(messages).where(eq(messages.id, message!.id));
    expect(survivedMessage).toBeDefined();
    expect(survivedMessage!.senderId).toBeNull();
  });
});
