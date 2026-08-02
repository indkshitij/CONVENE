import { char, index, integer, pgTable, serial, text, unique } from "drizzle-orm/pg-core";
import { geographyPoint } from "./custom-types";

// PRD §16.3 GEOGRAPHY REFERENCE — mirrors migrations/0001_profile_geo.sql exactly.
export const countries = pgTable("countries", {
  code: char("code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
  defaultTimezone: text("default_timezone"),
});

export const states = pgTable(
  "states",
  {
    id: serial("id").primaryKey(),
    countryCode: char("country_code", { length: 2 }).references(() => countries.code),
    name: text("name").notNull(),
  },
  (table) => [unique("states_country_code_name_unique").on(table.countryCode, table.name)],
);

export const cities = pgTable(
  "cities",
  {
    id: serial("id").primaryKey(),
    stateId: integer("state_id").references(() => states.id),
    countryCode: char("country_code", { length: 2 }).references(() => countries.code),
    name: text("name").notNull(),
    population: integer("population"),
    centroid: geographyPoint("centroid"),
    timezone: text("timezone").notNull(),
  },
  (table) => [
    index("idx_cities_name").using("gin", table.name.op("gin_trgm_ops")),
    index("idx_cities_centroid").using("gist", table.centroid),
  ],
);

export type Country = typeof countries.$inferSelect;
export type State = typeof states.$inferSelect;
export type City = typeof cities.$inferSelect;
