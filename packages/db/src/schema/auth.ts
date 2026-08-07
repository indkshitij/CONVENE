import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { citext } from "./custom-types";
import { users } from "./users";

// PRD §16.3 IDENTITY — mirrors migrations/0000_identity.sql exactly.
export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUid: text("provider_uid").notNull(),
    email: citext("email"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_auth_provider", sql`${table.provider} IN ('google','linkedin','apple')`),
    unique("uq_auth_provider").on(table.provider, table.providerUid),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    deviceFingerprint: text("device_fingerprint").notNull(),
    // P5.3/migrations/0005_refresh_sessions.sql — a human-readable label
    // and coarse country for the session-list endpoint (§10.1.7 #9).
    deviceLabel: text("device_label"),
    ipCountry: char("ip_country", { length: 2 }),
    parentId: uuid("parent_id").references((): AnyPgColumn => refreshTokens.id),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_rt_family")
      .on(table.familyId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type AuthIdentity = typeof authIdentities.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
