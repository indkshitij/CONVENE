import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@convene/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConnectionsRepository } from "./connections.repository";

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
  "0008_profile_search_and_name_change",
  "0009_verification_ladder",
  "0010_location_encryption",
  "0011_candidate_generation_indexes",
  "0012_schedule_intents",
  "0013_matching_fairness_and_weights",
];

// P14.2's own acceptance criterion: "no partial accept state is
// reachable." Verified against real Postgres because the property being
// tested — a multi-statement transaction either fully commits or fully
// rolls back — can't be proven by mocking the query builder; it depends
// on Postgres's own transaction semantics.
describe.skipIf(!dockerAvailable)("ConnectionsRepository.acceptRequest (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: ConnectionsRepository;

  beforeAll(async () => {
    container = await GenericContainer.fromDockerfile(dockerContextDir)
      .build()
      .then((image) =>
        image.withExposedPorts(5432).withEnvironment({ POSTGRES_PASSWORD: "test" }).start(),
      );

    const port = container.getMappedPort(5432);
    const host = container.getHost();
    sql = postgres(`postgres://postgres:test@${host}:${port}/postgres`, { max: 10 });
    db = drizzle(sql, { schema });

    for (const migration of MIGRATIONS) {
      const upSql = readFileSync(join(migrationsDir, `${migration}.sql`), "utf8");
      await sql.unsafe(upSql);
    }

    // messages is PARTITION BY RANGE (created_at) with no partitions
    // created by the migration itself (see scripts/create-partitions.ts)
    // — provision this month's partition so inserts succeed.
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS messages_current PARTITION OF messages FOR VALUES FROM ('${from}') TO ('${to}')`,
    );

    repo = new ConnectionsRepository({ db } as never);
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await sql`DELETE FROM messages`;
    await sql`DELETE FROM conversation_participants`;
    await sql`DELETE FROM conversations`;
    await sql`DELETE FROM connection_requests`;
    await sql`DELETE FROM connections`;
    await sql`DELETE FROM user_intents`;
    await sql`DELETE FROM profiles`;
    await sql`DELETE FROM users`;
  });

  async function createUser(suffix: string): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version, status)
      VALUES (${"conn-test-" + suffix + "-" + Math.random().toString(36).slice(2) + "@example.com"}, ${"User " + suffix}, '1990-01-01', 'v1', 'active')
      RETURNING id
    `;
    const userId = (user as { id: string }).id;
    await sql`INSERT INTO profiles (user_id, years_experience) VALUES (${userId}, 5)`;
    return userId;
  }

  async function createPendingRequest(
    senderId: string,
    recipientId: string,
    note: string | null,
  ): Promise<string> {
    const [intent] = await sql`
      INSERT INTO user_intents (user_id, type, is_primary, status, is_paused, expires_at)
      VALUES (${senderId}, 'hiring', true, 'active', false, now() + interval '30 days')
      RETURNING id
    `;
    const intentId = (intent as { id: string }).id;
    const [request] = await sql`
      INSERT INTO connection_requests (sender_id, recipient_id, intent_id, note, match_score, status)
      VALUES (${senderId}, ${recipientId}, ${intentId}, ${note}, 78, 'pending')
      RETURNING id
    `;
    return (request as { id: string }).id;
  }

  it("commits the connection, conversation, participants, and first message atomically", async () => {
    const sender = await createUser("sender");
    const recipient = await createUser("recipient");
    const requestId = await createPendingRequest(sender, recipient, "Would love to connect.");

    const result = await repo.acceptRequest(requestId, new Date());

    expect(result).not.toBeNull();
    const [connectionRow] =
      await sql`SELECT * FROM connections WHERE id = ${result!.connection.id}`;
    expect(connectionRow).toBeDefined();
    const [lo, hi] = sender < recipient ? [sender, recipient] : [recipient, sender];
    expect((connectionRow as { user_a_id: string }).user_a_id).toBe(lo);
    expect((connectionRow as { user_b_id: string }).user_b_id).toBe(hi);

    const [conversationRow] =
      await sql`SELECT * FROM conversations WHERE id = ${result!.conversationId}`;
    expect(conversationRow).toBeDefined();
    expect((conversationRow as { message_seq: string }).message_seq).toBe("1");

    const participants =
      await sql`SELECT user_id FROM conversation_participants WHERE conversation_id = ${result!.conversationId}`;
    expect(participants.map((p) => (p as { user_id: string }).user_id).sort()).toEqual(
      [sender, recipient].sort(),
    );

    const [messageRow] = await sql`SELECT * FROM messages WHERE id = ${result!.firstMessageId}`;
    expect(messageRow).toBeDefined();
    expect((messageRow as { body: string }).body).toBe("Would love to connect.");
    expect((messageRow as { sender_id: string }).sender_id).toBe(sender);

    const [requestRow] = await sql`SELECT status FROM connection_requests WHERE id = ${requestId}`;
    expect((requestRow as { status: string }).status).toBe("accepted");
  });

  it("creates no connection row and leaves the request 'pending' when a forced failure occurs during conversation creation", async () => {
    const sender = await createUser("sender2");
    const recipient = await createUser("recipient2");
    const requestId = await createPendingRequest(sender, recipient, "Would love to connect.");

    // Wrap the transaction so the *conversations* insert specifically
    // throws — after the connection row's own insert has already run —
    // proving the whole transaction rolls back, not just the statement
    // that failed. `db.insert(connections)` succeeds; `db.insert(conversations)`
    // is the one call this proxy intercepts.
    const failingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "transaction") return Reflect.get(target, prop, receiver);
        return async (callback: (tx: typeof db) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            const originalInsert = tx.insert.bind(tx);
            const patchedTx = new Proxy(tx, {
              get(txTarget, txProp, txReceiver) {
                if (txProp !== "insert") return Reflect.get(txTarget, txProp, txReceiver);
                return (table: unknown) => {
                  if (table === schema.conversations) {
                    throw new Error("forced failure during conversation creation");
                  }
                  return originalInsert(table as never);
                };
              },
            });
            return callback(patchedTx as unknown as typeof db);
          });
      },
    });
    const failingRepo = new ConnectionsRepository({ db: failingDb } as never);

    await expect(failingRepo.acceptRequest(requestId, new Date())).rejects.toThrow(
      "forced failure during conversation creation",
    );

    const connectionCount = await sql`SELECT count(*)::int AS count FROM connections`;
    expect((connectionCount[0] as { count: number }).count).toBe(0);
    const conversationCount = await sql`SELECT count(*)::int AS count FROM conversations`;
    expect((conversationCount[0] as { count: number }).count).toBe(0);

    const [requestRow] = await sql`SELECT status FROM connection_requests WHERE id = ${requestId}`;
    // The UPDATE that flips status to 'accepted' happens inside the same
    // transaction as the (now-failing) connections/conversations inserts,
    // so it rolls back too — the request is left exactly as it was.
    expect((requestRow as { status: string }).status).toBe("pending");
  });
});
