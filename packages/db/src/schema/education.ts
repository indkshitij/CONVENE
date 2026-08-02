import { sql } from "drizzle-orm";
import { check, date, index, pgTable, smallint, text, uuid, varchar } from "drizzle-orm/pg-core";
import { media } from "./media";
import { users } from "./users";

// NOT GIVEN EXPLICIT DDL IN THE PRD — §16.3 says these three tables "follow
// the same pattern: UUID pk, user_id FK CASCADE, position ordering, length
// CHECKs" without full field lists. Fields below come from §10.2.2's field
// spec and the §10.1 onboarding example ({school, degree, field}). Flagged
// as an assumption, not a transcription — see migrations/0001_profile_geo.sql.
export const education = pgTable(
  "education",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    school: varchar("school", { length: 150 }).notNull(),
    degree: varchar("degree", { length: 100 }),
    fieldOfStudy: varchar("field_of_study", { length: 100 }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    description: text("description"),
    position: smallint("position").notNull().default(0),
  },
  (table) => [
    check(
      "chk_edu_dates",
      sql`${table.endDate} IS NULL OR ${table.startDate} IS NULL OR ${table.endDate} > ${table.startDate}`,
    ),
    check("chk_edu_description_length", sql`char_length(${table.description}) <= 500`),
    index("idx_edu_user").on(table.userId, table.position),
  ],
);

// FR-PROF-005: "Manage certifications with issuer, dates, credential URL."
export const certifications = pgTable(
  "certifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 150 }).notNull(),
    issuer: varchar("issuer", { length: 150 }).notNull(),
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),
    credentialUrl: text("credential_url"),
    position: smallint("position").notNull().default(0),
  },
  (table) => [
    check(
      "chk_cert_dates",
      sql`${table.expiresAt} IS NULL OR ${table.issuedAt} IS NULL OR ${table.expiresAt} > ${table.issuedAt}`,
    ),
    check(
      "chk_cert_credential_url",
      sql`${table.credentialUrl} IS NULL OR ${table.credentialUrl} LIKE 'https://%'`,
    ),
    index("idx_cert_user").on(table.userId, table.position),
  ],
);

// §10.2.7: "portfolio.url — https only." ≤12 entries, "conversation material."
export const portfolioItems = pgTable(
  "portfolio_items",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 150 }).notNull(),
    url: text("url").notNull(),
    description: text("description"),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    position: smallint("position").notNull().default(0),
  },
  (table) => [
    check("chk_portfolio_url", sql`${table.url} LIKE 'https://%'`),
    check("chk_portfolio_description_length", sql`char_length(${table.description}) <= 500`),
    index("idx_portfolio_user").on(table.userId, table.position),
  ],
);

export type Education = typeof education.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type PortfolioItem = typeof portfolioItems.$inferSelect;
