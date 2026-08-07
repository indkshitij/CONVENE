import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §16.3 "REPUTATION, MEDIA, BILLING" (plans, subscriptions) — mirrors
// migrations/0003_matching_safety_billing_audit.sql, plus subscriptions.
// user_id relaxed to nullable + ON DELETE SET NULL by
// migrations/0007_erasure_retention_fks.sql (§20.6: financial records are
// retained 7 years, not cascade-deleted with the user).
export const plans = pgTable("plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  entitlements: jsonb("entitlements").notNull(),
  priceCents: integer("price_cents"),
  currency: char("currency", { length: 3 }),
  interval: text("interval"),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    planCode: text("plan_code")
      .notNull()
      .references(() => plans.code),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "chk_subscription_status",
      sql`${table.status} IN ('trialing','active','past_due','canceled','expired')`,
    ),
    uniqueIndex("uq_sub_active")
      .on(table.userId)
      .where(sql`${table.status} IN ('trialing','active','past_due')`),
  ],
);

// NOT GIVEN EXPLICIT DDL IN THE PRD — see the migration for the full
// explanation.
export const payments = pgTable(
  "payments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "chk_payment_status",
      sql`${table.status} IN ('pending','succeeded','failed','refunded')`,
    ),
    index("idx_payments_subscription").on(table.subscriptionId, table.createdAt.desc()),
  ],
);

// NOT GIVEN EXPLICIT DDL IN THE PRD — see the migration for the full
// explanation. Grouped here (not a dedicated file) since usage/cost tracking
// is closest to billing among the P2.4 prompt's five named schema files.
export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    tokensUsed: integer("tokens_used"),
    costCents: integer("cost_cents"),
    cached: boolean("cached").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_ai_usage_user_time").on(table.userId, table.createdAt.desc())],
);

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type NewAiUsageLog = typeof aiUsageLogs.$inferInsert;
