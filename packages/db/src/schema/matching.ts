import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §16.3 MATCHING — mirrors migrations/0003_matching_safety_billing_audit.sql exactly.
export const matchCandidates = pgTable(
  "match_candidates",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    staticScore: numeric("static_score", { precision: 5, scale: 4 }).notNull(),
    components: jsonb("components").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.candidateId] }),
    index("idx_mc_user_score").on(table.userId, table.staticScore.desc()),
  ],
);

export const feedImpressions = pgTable(
  "feed_impressions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    count: smallint("count").notNull().default(1),
    interacted: boolean("interacted").notNull().default(false),
    lastShownAt: timestamp("last_shown_at", { withTimezone: true }).notNull().defaultNow(),
    // P12.3 / §11.11: "Record impressions with the expansion stage and
    // score band" for the fairness audit query.
    expansionStage: smallint("expansion_stage"),
    scoreBand: text("score_band"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.candidateId] })],
);

// P12.3 / AD-8 — see migrations/0013's own comment for the full
// explanation of why this table (not a real Flagsmith call) is what this
// codebase's default RemoteConfigProvider reads/writes.
export const matchingWeightConfigs = pgTable(
  "matching_weight_configs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    weights: jsonb("weights").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_matching_weight_configs_active")
      .on(table.isActive)
      .where(sql`${table.isActive}`),
  ],
);

// NOT GIVEN EXPLICIT DDL IN THE PRD — see the migration for the full
// explanation. Grouped here (not a dedicated file) since matching.ts is the
// closest fit among the P2.4 prompt's five named schema files.
export const profileViews = pgTable(
  "profile_views",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedId: uuid("viewed_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_profile_views_viewed").on(table.viewedId, table.viewedAt.desc())],
);

export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    query: jsonb("query").notNull().default({}),
    alertEnabled: boolean("alert_enabled").notNull().default(false),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_saved_searches_user").on(table.userId),
    index("idx_saved_searches_alerts")
      .on(table.alertEnabled)
      .where(sql`${table.alertEnabled}`),
  ],
);

export type MatchCandidate = typeof matchCandidates.$inferSelect;
export type FeedImpression = typeof feedImpressions.$inferSelect;
export type ProfileView = typeof profileViews.$inferSelect;
export type SavedSearch = typeof savedSearches.$inferSelect;
export type NewSavedSearch = typeof savedSearches.$inferInsert;
export type MatchingWeightConfig = typeof matchingWeightConfigs.$inferSelect;
export type NewMatchingWeightConfig = typeof matchingWeightConfigs.$inferInsert;
