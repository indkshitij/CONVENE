import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §16.3 "SAFETY & AUDIT" (reports, moderation_actions) — mirrors
// migrations/0003_matching_safety_billing_audit.sql exactly.
export const reports = pgTable(
  "reports",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    reference: text("reference").notNull().unique(),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    description: text("description"),
    evidence: jsonb("evidence").notNull().default({}),
    status: text("status").notNull().default("open"),
    assignedTo: uuid("assigned_to"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "chk_report_status",
      sql`${table.status} IN ('open','in_review','upheld','dismissed','escalated')`,
    ),
    index("idx_reports_queue")
      .on(table.status, table.severity, table.slaDueAt)
      .where(sql`${table.status} IN ('open','in_review')`),
  ],
);

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").references(() => reports.id),
    adminId: uuid("admin_id").notNull(),
    action: text("action").notNull(),
    policyClause: text("policy_clause").notNull(),
    rationale: text("rationale").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "chk_moderation_action",
      sql`${table.action} IN ('notice','warning','throttle','shadow_limit','suspend','ban','reverse')`,
    ),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ModerationAction = typeof moderationActions.$inferSelect;
