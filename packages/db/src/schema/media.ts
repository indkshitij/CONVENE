import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { conversations } from "./messaging";

// PRD §16.3 "REPUTATION, MEDIA, BILLING" (media only — mirrors
// migrations/0001_profile_geo.sql exactly). Referenced by profiles, so it's
// created first in the migration.
export const media = pgTable(
  "media",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    derivatives: jsonb("derivatives").notNull().default({}),
    perceptualHash: text("perceptual_hash"),
    moderationState: text("moderation_state").notNull().default("pending"),
    avScanState: text("av_scan_state").notNull().default("pending"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // P16.1 (migration 0015) — see that migration's own comment: the
    // PRD's media DDL has no FK to conversations/messages, so this is the
    // minimum needed to make §17.7's "participant check" on signed serve
    // URLs a real, checkable thing for message attachments.
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    check(
      "chk_media_kind",
      sql`${table.kind} IN ('avatar','message_image','message_file','voice','resume','export')`,
    ),
    check(
      "chk_media_moderation_state",
      sql`${table.moderationState} IN ('pending','clean','rejected','quarantined')`,
    ),
    index("idx_media_gc")
      .on(table.createdAt)
      .where(sql`${table.committedAt} IS NULL`),
    index("idx_media_phash")
      .on(table.perceptualHash)
      .where(sql`${table.kind} = 'avatar'`),
    index("idx_media_conversation")
      .on(table.conversationId)
      .where(sql`${table.conversationId} IS NOT NULL`),
  ],
);

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
