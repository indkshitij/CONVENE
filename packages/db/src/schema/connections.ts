import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { requestStatus } from "./enums";
import { userIntents } from "./intents";
import { users } from "./users";

// PRD §10.6.8 — mirrors migrations/0002_intents_availability_messaging.sql exactly.
export const connections = pgTable(
  "connections",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    intentId: uuid("intent_id").references(() => userIntents.id, { onDelete: "set null" }),
    matchScore: smallint("match_score"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (table) => [
    check("chk_pair_order", sql`${table.userAId} < ${table.userBId}`),
    check("chk_no_self", sql`${table.userAId} <> ${table.userBId}`),
    uniqueIndex("uq_connection_pair")
      .on(table.userAId, table.userBId)
      .where(sql`${table.removedAt} IS NULL`),
    index("idx_conn_a")
      .on(table.userAId)
      .where(sql`${table.removedAt} IS NULL`),
    index("idx_conn_b")
      .on(table.userBId)
      .where(sql`${table.removedAt} IS NULL`),
  ],
);

export const connectionRequests = pgTable(
  "connection_requests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    intentId: uuid("intent_id").references(() => userIntents.id, { onDelete: "set null" }),
    note: varchar("note", { length: 300 }),
    matchScore: smallint("match_score"),
    matchReasons: jsonb("match_reasons"),
    source: text("source"),
    status: requestStatus("status").notNull().default("pending"),
    isQueued: boolean("is_queued").notNull().default(false),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(now() + INTERVAL '14 days')`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_no_self_request", sql`${table.senderId} <> ${table.recipientId}`),
    uniqueIndex("uq_pending_request")
      .on(table.senderId, table.recipientId)
      .where(sql`${table.status} = 'pending'`),
    index("idx_req_recipient").on(table.recipientId, table.status, table.matchScore.desc()),
    index("idx_req_expiry")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    check("chk_no_self_block", sql`${table.blockerId} <> ${table.blockedId}`),
    index("idx_blocks_blocked").on(table.blockedId),
  ],
);

export const matchSuppressions = pgTable(
  "match_suppressions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    suppressedId: uuid("suppressed_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(now() + INTERVAL '90 days')`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.suppressedId] })],
);

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionRequest = typeof connectionRequests.$inferSelect;
export type NewConnectionRequest = typeof connectionRequests.$inferInsert;
export type Block = typeof blocks.$inferSelect;
export type MatchSuppression = typeof matchSuppressions.$inferSelect;
