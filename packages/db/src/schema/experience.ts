import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { employmentType } from "./enums";
import { users } from "./users";

// PRD §16.3 PROFILE — mirrors migrations/0001_profile_geo.sql exactly.
export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyName: varchar("company_name", { length: 100 }).notNull(),
    title: varchar("title", { length: 100 }).notNull(),
    employmentType: employmentType("employment_type"),
    locationText: varchar("location_text", { length: 120 }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    isCurrent: boolean("is_current").notNull().default(false),
    description: text("description"),
    position: smallint("position").notNull().default(0),
  },
  (table) => [
    check("chk_dates", sql`${table.endDate} IS NULL OR ${table.endDate} > ${table.startDate}`),
    check(
      "chk_current",
      sql`(${table.isCurrent} AND ${table.endDate} IS NULL) OR NOT ${table.isCurrent}`,
    ),
    check("chk_exp_description_length", sql`char_length(${table.description}) <= 1200`),
    index("idx_exp_user").on(table.userId, table.startDate.desc()),
  ],
);

export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
