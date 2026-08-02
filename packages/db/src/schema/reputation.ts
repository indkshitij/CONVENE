import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §16.3 "REPUTATION, MEDIA, BILLING" (reputation_scores) — mirrors
// migrations/0003_matching_safety_billing_audit.sql exactly.
export const reputationScores = pgTable(
  "reputation_scores",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    score: smallint("score").notNull().default(50),
    band: text("band").notNull().default("new"),
    components: jsonb("components").notNull().default({}),
    responseRate: numeric("response_rate", { precision: 4, scale: 3 }),
    medianResponseMinutes: smallint("median_response_minutes"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("chk_reputation_score", sql`${table.score} BETWEEN 0 AND 100`)],
);

// NOT GIVEN EXPLICIT DDL IN THE PRD — see the migration for the full
// explanation. Grouped here (not a dedicated file) as the closest fit among
// the P2.4 prompt's five named schema files: both are per-user account state.
export const devices = pgTable(
  "devices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    pushToken: text("push_token").notNull(),
    appVersion: text("app_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_device_platform", sql`${table.platform} IN ('ios','android','web')`),
    uniqueIndex("uq_device_token").on(table.pushToken),
  ],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  notificationPrefs: jsonb("notification_prefs").notNull().default({}),
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
  quietHoursStart: time("quiet_hours_start"),
  quietHoursEnd: time("quiet_hours_end"),
  showLastSeen: boolean("show_last_seen").notNull().default(true),
  showReadReceipts: boolean("show_read_receipts").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReputationScore = typeof reputationScores.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type UserSettings = typeof userSettings.$inferSelect;
