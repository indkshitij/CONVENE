import { sql } from "drizzle-orm";
import { check, index, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §17.4 / §10.1.8 — mirrors migrations/0004_auth_session_security.sql
// exactly. Append-only: each OTP send creates a new row; the most recent
// non-consumed, non-expired row for (user_id, channel) is the active
// challenge.
export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_otp_channel", sql`${table.channel} IN ('email', 'phone')`),
    index("idx_otp_challenges_active").on(table.userId, table.channel, table.createdAt.desc()),
  ],
);

export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type NewOtpChallenge = typeof otpChallenges.$inferInsert;
