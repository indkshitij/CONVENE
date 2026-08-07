import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §10.2.5 L4 + §20.4 — "ID images are never stored by Convene; only
// the provider's verification reference and result." Mirrors
// migrations/0009_verification_ladder.sql exactly: no document data, no
// PII beyond what the provider reference implies.
export const identityVerifications = pgTable(
  "identity_verifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference").notNull(),
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "chk_identity_verification_result",
      sql`${table.result} IN ('pending', 'approved', 'rejected')`,
    ),
    index("idx_identity_verifications_user").on(table.userId, table.createdAt.desc()),
  ],
);

export type IdentityVerification = typeof identityVerifications.$inferSelect;
export type NewIdentityVerification = typeof identityVerifications.$inferInsert;
