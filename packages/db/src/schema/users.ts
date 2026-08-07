import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { citext } from "./custom-types";
import { userRole, userStatus } from "./enums";

// PRD §16.3 IDENTITY — mirrors migrations/0000_identity.sql, plus
// token_version added by migrations/0004_auth_session_security.sql (§17.4)
// and name_change_window_started_at added by
// migrations/0008_profile_search_and_name_change.sql (BR-PROF-07).
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    email: citext("email").unique(),
    phone: varchar("phone", { length: 20 }).unique(),
    passwordHash: text("password_hash"),
    fullName: varchar("full_name", { length: 80 }).notNull(),
    dateOfBirth: date("date_of_birth").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    status: userStatus("status").notNull().default("pending_verification"),
    role: userRole("role").notNull().default("user"),
    onboardingStep: smallint("onboarding_step").notNull().default(1),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    termsVersion: text("terms_version").notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    nameChangeCount: smallint("name_change_count").notNull().default(0),
    nameChangeWindowStartedAt: timestamp("name_change_window_started_at", { withTimezone: true }),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    purgeAt: timestamp("purge_at", { withTimezone: true }),
    attribution: jsonb("attribution").notNull().default({}),
    tokenVersion: integer("token_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_contact", sql`${table.email} IS NOT NULL OR ${table.phone} IS NOT NULL`),
    check("chk_adult", sql`${table.dateOfBirth} <= (CURRENT_DATE - INTERVAL '18 years')`),
    index("idx_users_status_active")
      .on(table.status, table.lastActiveAt.desc())
      .where(sql`${table.status} = 'active'`),
    index("idx_users_purge")
      .on(table.purgeAt)
      .where(sql`${table.purgeAt} IS NOT NULL`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
