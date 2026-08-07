import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import { geographyPoint, tsvector } from "./custom-types";
import { employmentType, locPrivacy, remotePref, visibility } from "./enums";
import { cities } from "./geo";
import { media } from "./media";
import { users } from "./users";

// NOT GIVEN EXPLICIT DDL IN THE PRD — see migrations/0001_profile_geo.sql
// for the full explanation. profiles.industry_id references this table but
// §16.3 never defines it.
export const industries = pgTable("industries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  adjacentIndustryIds: integer("adjacent_industry_ids")
    .array()
    .notNull()
    .default(sql`'{}'::integer[]`),
});

// PRD §16.3 PROFILE — mirrors migrations/0001_profile_geo.sql, plus
// headline/job_title/timezone relaxed to nullable by
// migrations/0004_auth_session_security.sql (a profiles row is created at
// registration, Step 1 of onboarding, before these Step-2/Step-5 fields exist).
export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    headline: varchar("headline", { length: 120 }),
    about: text("about"),
    avatarMediaId: uuid("avatar_media_id").references(() => media.id, { onDelete: "set null" }),
    resumeMediaId: uuid("resume_media_id").references(() => media.id, { onDelete: "set null" }),
    industryId: integer("industry_id").references(() => industries.id),
    jobTitle: varchar("job_title", { length: 100 }),
    companyName: varchar("company_name", { length: 100 }),
    companyVerified: boolean("company_verified").notNull().default(false),
    employmentType: employmentType("employment_type"),
    yearsExperience: numeric("years_experience", { precision: 4, scale: 1 }).notNull().default("0"),
    yearsExperienceOverride: boolean("years_experience_override").notNull().default(false),
    socialLinks: jsonb("social_links").notNull().default({}),
    cityId: integer("city_id").references(() => cities.id),
    coordinates: geographyPoint("coordinates"),
    geohash5: char("geohash_5", { length: 5 }),
    geohash3: char("geohash_3", { length: 3 }),
    timezone: text("timezone"),
    locationSource: text("location_source"),
    locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
    locationPrivacy: locPrivacy("location_privacy").notNull().default("city_only"),
    profileVisibility: visibility("profile_visibility").notNull().default("public"),
    searchRadiusKm: integer("search_radius_km").notNull().default(25),
    autoExpandRadius: boolean("auto_expand_radius").notNull().default(true),
    remotePreference: remotePref("remote_preference").notNull().default("any"),
    openToRelocate: boolean("open_to_relocate").notNull().default(false),
    relocateCityIds: integer("relocate_city_ids").array(),
    verificationLevel: smallint("verification_level").notNull().default(0),
    profileCompletion: smallint("profile_completion").notNull().default(0),
    searchVector: tsvector("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_prof_about_length", sql`char_length(${table.about}) <= 2000`),
    check("chk_prof_years_experience", sql`${table.yearsExperience} BETWEEN 0 AND 60`),
    check("chk_prof_location_source", sql`${table.locationSource} IN ('gps','manual','ip')`),
    check("chk_prof_search_radius", sql`${table.searchRadiusKm} BETWEEN 1 AND 500`),
    check("chk_prof_verification_level", sql`${table.verificationLevel} BETWEEN 0 AND 4`),
    index("idx_prof_coords").using("gist", table.coordinates),
    index("idx_prof_geohash5")
      .on(table.geohash5)
      .where(sql`${table.locationPrivacy} <> 'hidden'`),
    index("idx_prof_city").on(table.cityId, table.profileCompletion.desc()),
    index("idx_prof_industry").on(table.industryId, table.yearsExperience),
    index("idx_prof_search").using("gin", table.searchVector),
    index("idx_prof_discoverable")
      .on(table.profileCompletion)
      .where(
        sql`${table.profileVisibility} IN ('public','authenticated') AND ${table.profileCompletion} >= 40`,
      ),
  ],
);

export const profileEmbeddings = pgTable("profile_embeddings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // HNSW index (m=16, ef_construction=64) is created in the raw SQL
  // migration — drizzle-kit doesn't model index storage parameters.
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  sourceHash: text("source_hash").notNull(),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Industry = typeof industries.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type ProfileEmbedding = typeof profileEmbeddings.$inferSelect;
