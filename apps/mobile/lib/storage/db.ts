import * as SQLite from "expo-sqlite";

// §18.8: "SQLite for the message cache and outbox." The message cache
// mirrors what's already been fetched from apps/api (so a chat screen
// has something to render immediately offline, before a live refetch);
// the outbox holds messages composed while offline, keyed by their own
// client-generated `client_msg_id` (the same idempotency key BR-MSG's
// send path already expects — see apps/api's messages.service.ts) so a
// queued send can't be double-delivered once connectivity returns.
const DB_NAME = "convene.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS message_cache (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT,
        body TEXT,
        type TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_cache_conversation ON message_cache (conversation_id, sequence);

      CREATE TABLE IF NOT EXISTS outbox (
        client_msg_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );
    `);
    return db;
  });
  return dbPromise;
}

export interface CachedMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string | null;
  type: string;
  sequence: number;
  created_at: string;
}

export async function cacheMessages(messages: CachedMessage[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const message of messages) {
      await db.runAsync(
        `INSERT OR REPLACE INTO message_cache (id, conversation_id, sender_id, body, type, sequence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.conversation_id,
          message.sender_id,
          message.body,
          message.type,
          message.sequence,
          message.created_at,
        ],
      );
    }
  });
}

export async function getCachedMessages(conversationId: string): Promise<CachedMessage[]> {
  const db = await getDb();
  return db.getAllAsync<CachedMessage>(
    `SELECT * FROM message_cache WHERE conversation_id = ? ORDER BY sequence ASC`,
    [conversationId],
  );
}

export interface OutboxEntry {
  client_msg_id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  status: "pending" | "sent" | "failed";
}

export async function enqueueOutboxMessage(entry: OutboxEntry): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO outbox (client_msg_id, conversation_id, body, created_at, status) VALUES (?, ?, ?, ?, ?)`,
    [entry.client_msg_id, entry.conversation_id, entry.body, entry.created_at, entry.status],
  );
}

export async function getPendingOutboxMessages(): Promise<OutboxEntry[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxEntry>(
    `SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC`,
  );
}

export async function markOutboxMessageSent(clientMsgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET status = 'sent' WHERE client_msg_id = ?`, [clientMsgId]);
}
