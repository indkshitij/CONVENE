import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §16.3 PROFILE — mirrors migrations/0001_profile_geo.sql exactly.
export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  functionalArea: text("functional_area"),
  aliases: text("aliases").array(),
  embedding: vector("embedding", { dimensions: 1024 }),
  usageCount: integer("usage_count").notNull().default(0),
  isApproved: boolean("is_approved").notNull().default(true),
});

export const userSkills = pgTable(
  "user_skills",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: integer("skill_id")
      .notNull()
      .references(() => skills.id),
    proficiency: text("proficiency"),
    years: numeric("years", { precision: 3, scale: 1 }),
    position: smallint("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.skillId] }),
    check(
      "chk_user_skills_proficiency",
      sql`${table.proficiency} IN ('beginner','intermediate','advanced','expert')`,
    ),
    index("idx_us_skill").on(table.skillId),
  ],
);

// NOT GIVEN EXPLICIT DDL IN THE PRD — see migrations/0001_profile_geo.sql
// for the full explanation. Modelled on skills/user_skills.
export const interests = pgTable("interests", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
});

export const userInterests = pgTable(
  "user_interests",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    interestId: integer("interest_id")
      .notNull()
      .references(() => interests.id),
    position: smallint("position").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.interestId] })],
);

// NOT GIVEN EXPLICIT DDL IN THE PRD — see migrations/0001_profile_geo.sql
// for the full explanation. ISO 639-1 code as the natural key.
export const languages = pgTable("languages", {
  code: text("code").primaryKey(),
  name: text("name").notNull().unique(),
});

export const userLanguages = pgTable(
  "user_languages",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    languageCode: text("language_code")
      .notNull()
      .references(() => languages.code),
    proficiency: text("proficiency"),
    position: smallint("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.languageCode] }),
    check(
      "chk_user_languages_proficiency",
      sql`${table.proficiency} IN ('basic','conversational','fluent','native')`,
    ),
  ],
);

export type Skill = typeof skills.$inferSelect;
export type UserSkill = typeof userSkills.$inferSelect;
export type Interest = typeof interests.$inferSelect;
export type Language = typeof languages.$inferSelect;
