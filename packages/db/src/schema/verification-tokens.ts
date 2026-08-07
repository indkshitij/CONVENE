import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §10.1.8 — mirrors migrations/0004_auth_session_security.sql, plus
// 'password_reset' added by migrations/0006_password_reset_tokens.sql
// (P5.5, §10.1.7 endpoint 8) and 'work_email' + `target` added by
// migrations/0009_verification_ladder.sql (P7.3, §10.2.5 L3) to the same
// single-use signed-token table email verification already uses. `target`
// is nullable because email_verify/password_reset always target the
// owning user's own email (no ambiguity), while work_email sends to an
// address that may differ from users.email.
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    target: text("target"),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "chk_verification_token_type",
      sql`${table.type} IN ('email_verify', 'password_reset', 'work_email')`,
    ),
    index("idx_verification_tokens_user").on(table.userId, table.type),
  ],
);

export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;
