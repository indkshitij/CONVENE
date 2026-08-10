import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@convene/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MessagesRepository } from "./messages.repository";

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

// P15.1's own acceptance criteria: "50 simultaneous sends produce 50
// contiguous sequence numbers with no gaps or duplicates," "the same
// client_msg_id sent five times yields one message," and "zero
// acknowledged-message loss under crash injection." All three depend on
// real Postgres transaction/locking semantics that can't be proven by
// mocking the query builder.
describe.skipIf(!dockerAvailable)("MessagesRepository (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: MessagesRepository;

  beforeAll(async () => {
    container = await GenericContainer.fromDockerfile(dockerContextDir)
      .build()
      .then((image) =>
        image.withExposedPorts(5432).withEnvironment({ POSTGRES_PASSWORD: "test" }).start(),
      );

    const port = container.getMappedPort(5432);
    const host = container.getHost();
    sql = postgres(`postgres://postgres:test@${host}:${port}/postgres`, { max: 20 });
    db = drizzle(sql, { schema });

    for (const migration of MIGRATIONS) {
      const upSql = readFileSync(join(migrationsDir, `${migration}.sql`), "utf8");
      await sql.unsafe(upSql);
    }

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

    repo = new MessagesRepository({ db } as never);
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await sql`DELETE FROM messages`;
    await sql`DELETE FROM conversation_participants`;
    await sql`DELETE FROM conversations`;
    await sql`DELETE FROM users`;
  });

  async function createUser(suffix: string): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version, status)
      VALUES (${"msg-test-" + suffix + "-" + Math.random().toString(36).slice(2) + "@example.com"}, ${"User " + suffix}, '1990-01-01', 'v1', 'active')
      RETURNING id
    `;
    return (user as { id: string }).id;
  }

  async function createConversation(userA: string, userB: string): Promise<string> {
    const [conversation] =
      await sql`INSERT INTO conversations (type, state) VALUES ('direct', 'active') RETURNING id`;
    const conversationId = (conversation as { id: string }).id;
    await sql`INSERT INTO conversation_participants (conversation_id, user_id) VALUES (${conversationId}, ${userA}), (${conversationId}, ${userB})`;
    return conversationId;
  }

  it("50 concurrent sends (distinct client_msg_ids) produce 50 contiguous, gap-free, duplicate-free sequence numbers", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const conversationId = await createConversation(alice, bob);

    const sends = Array.from({ length: 50 }, (_, i) =>
      repo.sendMessage({
        conversationId,
        senderId: i % 2 === 0 ? alice : bob,
        clientMsgId: crypto.randomUUID(),
        body: `message ${i}`,
        replyToId: null,
        attachments: [],
      }),
    );
    const results = await Promise.all(sends);

    const sequences = results.map((r) => r.message.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(sequences).size).toBe(50);
    expect(results.every((r) => !r.isReplay)).toBe(true);

    const [conversationRow] =
      await sql`SELECT message_seq FROM conversations WHERE id = ${conversationId}`;
    expect(Number((conversationRow as { message_seq: string }).message_seq)).toBe(50);
  });

  it("the same client_msg_id sent five times (including concurrently) yields exactly one message", async () => {
    const alice = await createUser("alice2");
    const bob = await createUser("bob2");
    const conversationId = await createConversation(alice, bob);
    const clientMsgId = crypto.randomUUID();

    const attempts = Array.from({ length: 5 }, () =>
      repo.sendMessage({
        conversationId,
        senderId: alice,
        clientMsgId,
        body: "hello",
        replyToId: null,
        attachments: [],
      }),
    );
    const results = await Promise.all(attempts);

    const uniqueMessageIds = new Set(results.map((r) => r.message.id));
    expect(uniqueMessageIds.size).toBe(1);
    expect(results.filter((r) => r.isReplay).length).toBe(4);

    const rows =
      await sql`SELECT count(*)::int AS count FROM messages WHERE client_msg_id = ${clientMsgId}`;
    expect((rows[0] as { count: number }).count).toBe(1);
  });

  it("acknowledges nothing when a forced failure occurs before commit (crash injection)", async () => {
    const alice = await createUser("alice3");
    const bob = await createUser("bob3");
    const conversationId = await createConversation(alice, bob);

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
                  if (table === schema.messages) {
                    throw new Error("simulated crash before durable write");
                  }
                  return originalInsert(table as never);
                };
              },
            });
            return callback(patchedTx as unknown as typeof db);
          });
      },
    });
    const failingRepo = new MessagesRepository({ db: failingDb } as never);

    await expect(
      failingRepo.sendMessage({
        conversationId,
        senderId: alice,
        clientMsgId: crypto.randomUUID(),
        body: "never acked",
        replyToId: null,
        attachments: [],
      }),
    ).rejects.toThrow("simulated crash before durable write");

    const rows =
      await sql`SELECT count(*)::int AS count FROM messages WHERE conversation_id = ${conversationId}`;
    expect((rows[0] as { count: number }).count).toBe(0);
    // The sequence-allocating UPDATE that ran before the failing insert
    // also rolled back — otherwise a retried send would skip a number.
    const [conversationRow] =
      await sql`SELECT message_seq FROM conversations WHERE id = ${conversationId}`;
    expect(Number((conversationRow as { message_seq: string }).message_seq)).toBe(0);
  });

  it("gap-free catch-up: listAfterSequence returns everything after the cursor, in sequence order", async () => {
    const alice = await createUser("alice4");
    const bob = await createUser("bob4");
    const conversationId = await createConversation(alice, bob);

    for (let i = 0; i < 5; i++) {
      await repo.sendMessage({
        conversationId,
        senderId: alice,
        clientMsgId: crypto.randomUUID(),
        body: `m${i}`,
        replyToId: null,
        attachments: [],
      });
    }

    const after2 = await repo.listAfterSequence(conversationId, 2, 50);
    expect(after2.map((m) => m.sequence)).toEqual([3, 4, 5]);
  });
});
