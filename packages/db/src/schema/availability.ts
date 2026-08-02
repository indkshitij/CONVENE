import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { availabilityState } from "./enums";
import { userIntents } from "./intents";
import { users } from "./users";

// PRD §10.3.9 — mirrors migrations/0002_intents_availability_messaging.sql exactly.
export const availabilitySchedules = pgTable(
  "availability_schedules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    timezone: text("timezone").notNull(),
    rrule: text("rrule"),
    untilAt: timestamp("until_at", { withTimezone: true }),
    reminderMinutesBefore: integer("reminder_minutes_before").default(10),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_sched_duration", sql`${table.durationMinutes} BETWEEN 15 AND 240`),
    index("idx_sched_user_active")
      .on(table.userId)
      .where(sql`${table.isActive}`),
  ],
);

export const availabilitySessions = pgTable(
  "availability_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    state: availabilityState("state").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
    durationMinutes: integer("duration_minutes"),
    extensionsUsed: smallint("extensions_used").notNull().default(0),
    note: varchar("note", { length: 120 }),
    scheduleId: uuid("schedule_id").references(() => availabilitySchedules.id, {
      onDelete: "set null",
    }),
    source: text("source"),
    matchesViewed: integer("matches_viewed").notNull().default(0),
    requestsSent: integer("requests_sent").notNull().default(0),
    conversationsStarted: integer("conversations_started").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "chk_avail_end_reason",
      sql`${table.endReason} IN ('expired','manual','superseded','disconnected','admin','profile_private')`,
    ),
    check("chk_avail_duration", sql`${table.durationMinutes} BETWEEN 1 AND 240`),
    check("chk_avail_extensions", sql`${table.extensionsUsed} <= 3`),
    uniqueIndex("uq_avail_active_per_user")
      .on(table.userId)
      .where(sql`${table.endedAt} IS NULL`),
    index("idx_avail_live_expiry")
      .on(table.expiresAt)
      .where(sql`${table.endedAt} IS NULL AND ${table.state} = 'available_now'`),
    index("idx_avail_user_time").on(table.userId, table.startedAt.desc()),
  ],
);

export const availabilitySessionIntents = pgTable(
  "availability_session_intents",
  {
    sessionId: uuid("session_id").references(() => availabilitySessions.id, {
      onDelete: "cascade",
    }),
    intentId: uuid("intent_id").references(() => userIntents.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.intentId] })],
);

// §16.4 — trigger-maintained, not a real materialised view.
export const availabilityLive = pgTable(
  "availability_live",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    state: availabilityState("state").notNull(),
    sessionId: uuid("session_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    intentIds: uuid("intent_ids").array(),
    geohash5: char("geohash_5", { length: 5 }),
    cityId: integer("city_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_al_state_geo")
      .on(table.state, table.geohash5)
      .where(sql`${table.state} = 'available_now'`),
    index("idx_al_state_city").on(table.state, table.cityId),
  ],
);

export type AvailabilitySchedule = typeof availabilitySchedules.$inferSelect;
export type AvailabilitySession = typeof availabilitySessions.$inferSelect;
export type NewAvailabilitySession = typeof availabilitySessions.$inferInsert;
export type AvailabilityLive = typeof availabilityLive.$inferSelect;
