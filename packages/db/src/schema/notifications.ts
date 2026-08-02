import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §10.8 — mirrors migrations/0002_intents_availability_messaging.sql exactly.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data").notNull().default({}),
    collapseKey: text("collapse_key"),
    priority: text("priority").notNull().default("medium"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_notif_user_unread")
      .on(table.userId, table.createdAt.desc())
      .where(sql`${table.readAt} IS NULL`),
    uniqueIndex("uq_notif_collapse")
      .on(table.userId, table.collapseKey)
      .where(sql`${table.collapseKey} IS NOT NULL AND ${table.readAt} IS NULL`),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
