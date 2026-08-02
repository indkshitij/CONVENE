import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import postgres from "postgres";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const dockerContextDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "docker",
  "postgres",
);

function readMigration(name: string): string {
  return readFileSync(join(migrationsDir, name), "utf8");
}

const upMigrations = [
  "0000_identity.sql",
  "0001_profile_geo.sql",
  "0002_intents_availability_messaging.sql",
].map(readMigration);
const downMigrations = [
  "0002_intents_availability_messaging.down.sql",
  "0001_profile_geo.down.sql",
  "0000_identity.down.sql",
].map(readMigration);

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

// PRD §10.3/§10.4/§10.6/§10.7, tested per the P2.3 prompt spec: every
// partial unique index blocks the second insert it should, and a message
// insert lands in the correct monthly partition. Skips gracefully where
// Docker isn't available (see identity.integration.test.ts).
describe.skipIf(!dockerAvailable)(
  "intents/availability/messaging migration (Testcontainers)",
  () => {
    let container: StartedTestContainer;
    let sql: ReturnType<typeof postgres>;

    beforeAll(async () => {
      container = await GenericContainer.fromDockerfile(dockerContextDir)
        .build()
        .then((image) =>
          image
            .withEnvironment({
              POSTGRES_USER: "convene",
              POSTGRES_PASSWORD: "convene",
              POSTGRES_DB: "convene",
            })
            .withExposedPorts(5432)
            .start(),
        );

      const connectionUri = `postgres://convene:convene@${container.getHost()}:${container.getMappedPort(5432)}/convene`;
      sql = postgres(connectionUri, { max: 1 });

      for (const migration of upMigrations) {
        await sql.unsafe(migration);
      }

      // A single current-month partition — enough for the routing assertion.
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const partitionName = `messages_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
      await sql.unsafe(
        `CREATE TABLE ${partitionName} PARTITION OF messages FOR VALUES FROM ('${start.toISOString().slice(0, 10)}') TO ('${end.toISOString().slice(0, 10)}')`,
      );
    }, 120_000);

    afterAll(async () => {
      await sql?.end();
      await container?.stop();
    });

    async function createUser(email: string) {
      const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${email}, 'Test User', '1990-01-01', 'v1')
      RETURNING id
    `;
      return user!.id as string;
    }

    it("blocks a second active availability session for the same user", async () => {
      const userId = await createUser("avail@example.com");
      await sql`INSERT INTO availability_sessions (user_id, state) VALUES (${userId}, 'available_now')`;

      await expect(
        sql`INSERT INTO availability_sessions (user_id, state) VALUES (${userId}, 'busy')`,
      ).rejects.toThrow(/uq_avail_active_per_user/);
    });

    it("blocks a second primary intent for the same user", async () => {
      const userId = await createUser("intent@example.com");
      await sql`
      INSERT INTO user_intents (user_id, type, is_primary, expires_at)
      VALUES (${userId}, 'coffee_chat', true, now() + interval '7 days')
    `;

      await expect(
        sql`
        INSERT INTO user_intents (user_id, type, is_primary, expires_at)
        VALUES (${userId}, 'learning', true, now() + interval '7 days')
      `,
      ).rejects.toThrow(/uq_intent_primary/);
    });

    it("blocks a second pending connection request for the same pair", async () => {
      const senderId = await createUser("sender@example.com");
      const recipientId = await createUser("recipient@example.com");
      await sql`
      INSERT INTO connection_requests (sender_id, recipient_id)
      VALUES (${senderId}, ${recipientId})
    `;

      await expect(
        sql`
        INSERT INTO connection_requests (sender_id, recipient_id)
        VALUES (${senderId}, ${recipientId})
      `,
      ).rejects.toThrow(/uq_pending_request/);
    });

    it("routes an inserted message into the correct monthly partition", async () => {
      const userId = await createUser("msg@example.com");
      const [conversation] = await sql`INSERT INTO conversations DEFAULT VALUES RETURNING id`;
      const clientMsgId = "00000000-0000-7000-8000-000000000001";

      const [message] = await sql`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, sequence, body)
      VALUES (${conversation!.id}, ${userId}, ${clientMsgId}, 1, 'hello')
      RETURNING id, created_at
    `;

      const [routed] = await sql`
      SELECT tableoid::regclass::text AS partition
      FROM messages
      WHERE id = ${message!.id} AND created_at = ${message!.created_at}
    `;

      const now = new Date();
      const expectedPartition = `messages_${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      expect(routed!.partition).toBe(expectedPartition);
    });

    it("migrates down cleanly", async () => {
      for (const migration of downMigrations) {
        await sql.unsafe(migration);
      }

      const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('user_intents', 'availability_sessions', 'connections', 'messages', 'notifications')
    `;
      expect(tables).toHaveLength(0);
    });
  },
);

if (!dockerAvailable) {
  console.warn(
    "intents-availability-messaging.integration.test.ts: Docker not available, skipping Testcontainers suite.",
  );
}
