import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tsvector } from "./custom-types";
import { messageType } from "./enums";
import { connections } from "./connections";
import { users } from "./users";

// PRD §10.7.7 — mirrors migrations/0002_intents_availability_messaging.sql
// exactly. `messages` is PARTITION BY RANGE (created_at) in the raw SQL;
// drizzle-orm has no partitioning DSL, so this is a plain-table mirror for
// typed queries only — the migration/create-partitions.ts own the actual
// partitioned structure.
export const conversations = pgTable("conversations", {
  id: uuid("id")
    .primaryKey()
    .default(sql`public.uuidv7()`),
  connectionId: uuid("connection_id").references(() => connections.id, { onDelete: "set null" }),
  type: text("type").notNull().default("direct"),
  state: text("state").notNull().default("active"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  messageSeq: bigint("message_seq", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unreadCount: integer("unread_count").notNull().default(0),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
    isPinned: boolean("is_pinned").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index("idx_cp_user_list").on(table.userId, table.isArchived, table.isPinned.desc()),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id")
      .notNull()
      .default(sql`public.uuidv7()`),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id),
    clientMsgId: uuid("client_msg_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: messageType("type").notNull().default("text"),
    body: text("body"),
    replyToId: uuid("reply_to_id"),
    attachments: jsonb("attachments").notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    editCount: smallint("edit_count").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedScope: text("deleted_scope"),
    moderationState: text("moderation_state").notNull().default("pending"),
    searchVector: tsvector("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt] }),
    check("chk_msg_body_length", sql`char_length(${table.body}) <= 4000`),
    check("chk_msg_deleted_scope", sql`${table.deletedScope} IN ('everyone')`),
    check(
      "chk_msg_moderation_state",
      sql`${table.moderationState} IN ('pending','clean','flagged','retracted')`,
    ),
    uniqueIndex("uq_msg_client").on(table.conversationId, table.clientMsgId, table.createdAt),
    uniqueIndex("uq_msg_seq").on(table.conversationId, table.sequence, table.createdAt),
    index("idx_msg_conv_seq").on(table.conversationId, table.sequence.desc()),
    index("idx_msg_search").using("gin", table.searchVector),
  ],
);

// No FK on message_id — messages' PK is composite (id, created_at), which a
// plain UUID reference can't target. Matches PRD §10.7.7 exactly (no
// REFERENCES clause given for these three tables).
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: uuid("message_id").notNull(),
    createdAtRef: timestamp("created_at_ref", { withTimezone: true }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId] })],
);

export const messageHides = pgTable(
  "message_hides",
  {
    messageId: uuid("message_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId] })],
);

export const messageEdits = pgTable(
  "message_edits",
  {
    messageId: uuid("message_id").notNull(),
    version: smallint("version").notNull(),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.version] })],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type MessageHide = typeof messageHides.$inferSelect;
export type MessageEdit = typeof messageEdits.$inferSelect;
