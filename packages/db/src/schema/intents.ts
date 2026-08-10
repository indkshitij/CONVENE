import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { intentType } from "./enums";
import { users } from "./users";

// PRD §10.4.8 — mirrors migrations/0002_intents_availability_messaging.sql exactly.
export const userIntents = pgTable(
  "user_intents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: intentType("type").notNull(),
    detail: varchar("detail", { length: 200 }),
    metadata: jsonb("metadata").notNull().default({}),
    isPrimary: boolean("is_primary").notNull().default(false),
    isPaused: boolean("is_paused").notNull().default(false),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    renewedCount: smallint("renewed_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_user_intents_status", sql`${table.status} IN ('active','archived')`),
    uniqueIndex("uq_intent_active_type")
      .on(table.userId, table.type)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("uq_intent_primary")
      .on(table.userId)
      .where(sql`${table.isPrimary} AND ${table.status} = 'active'`),
    index("idx_intent_lookup")
      .on(table.type, table.status, table.expiresAt)
      .where(sql`${table.status} = 'active' AND NOT ${table.isPaused}`),
    index("idx_intent_expiry")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const intentComplementarity = pgTable(
  "intent_complementarity",
  {
    fromType: intentType("from_type").notNull(),
    toType: intentType("to_type").notNull(),
    weight: numeric("weight", { precision: 3, scale: 2 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fromType, table.toType] }),
    check("chk_complementarity_weight", sql`${table.weight} BETWEEN 0 AND 1`),
  ],
);

export const inboundIntentFilters = pgTable(
  "inbound_intent_filters",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    acceptedIntents: intentType("accepted_intents").array(),
    minExperienceYears: numeric("min_experience_years", { precision: 4, scale: 1 }),
    maxExperienceYears: numeric("max_experience_years", { precision: 4, scale: 1 }),
    industryIds: integer("industry_ids").array(),
    verifiedOnly: boolean("verified_only").notNull().default(false),
    maxInboundPerDay: integer("max_inbound_per_day"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("chk_max_inbound_per_day", sql`${table.maxInboundPerDay} BETWEEN 1 AND 200`)],
);

export type UserIntent = typeof userIntents.$inferSelect;
export type NewUserIntent = typeof userIntents.$inferInsert;
export type IntentComplementarity = typeof intentComplementarity.$inferSelect;
export type InboundIntentFilter = typeof inboundIntentFilters.$inferSelect;
export type NewInboundIntentFilter = typeof inboundIntentFilters.$inferInsert;
