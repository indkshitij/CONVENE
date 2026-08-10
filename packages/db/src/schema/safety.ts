import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// PRD §16.3 "SAFETY & AUDIT" (reports, moderation_actions) — mirrors
// migrations/0003_matching_safety_billing_audit.sql, plus
// moderation_actions.target_user_id relaxed to nullable + ON DELETE SET
// NULL by migrations/0007_erasure_retention_fks.sql (§20.6: upheld safety
// records are retained, not cascade-deleted with the user).
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
    // §10.10.2's eight categories — see migrations/0016_trust_safety_ladder.sql's
    // own comment for the CHECK constraint and the one pre-existing writer
    // it had to be kept compatible with.
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
    check(
      "chk_report_category",
      sql`${table.category} IN ('child_safety','threats_violence','harassment_hate','scam_fraud','sexual_content','impersonation','spam','other')`,
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
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    reportId: uuid("report_id").references(() => reports.id),
    // Nullable (P18.1): automated auto-actions (§10.10.2's "auto-action
    // pending review" column) have no acting human admin.
    adminId: uuid("admin_id"),
    action: text("action").notNull(),
    policyClause: text("policy_clause").notNull(),
    rationale: text("rationale").notNull(),
    // §10.10.3: a permanent ban starts "pending_approval" (recorded, not
    // yet enforced) until moderationActionApprovals reaches a second,
    // distinct admin; every other action goes straight to "active".
    status: text("status").notNull().default("active"),
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
    check(
      "chk_moderation_action_status",
      sql`${table.status} IN ('pending_approval','active','reversed')`,
    ),
  ],
);

// P18.1/§10.10.3: one row per admin who has approved a pending ban — the
// unique constraint (not just service-layer logic) is what makes "the
// same admin approving twice" structurally impossible.
export const moderationActionApprovals = pgTable(
  "moderation_action_approvals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    moderationActionId: uuid("moderation_action_id")
      .notNull()
      .references(() => moderationActions.id, { onDelete: "cascade" }),
    adminId: uuid("admin_id").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("uq_moderation_action_approval").on(table.moderationActionId, table.adminId)],
);

// P18.1/§10.10.3: "Appeal (all levels) -> SLA 72h, human review", "Appeals
// are reviewed by a different admin than the one who acted." The
// different-reviewer rule is a cross-row comparison enforced in
// AppealsService.review, not expressible as a single-table CHECK here.
export const appeals = pgTable(
  "appeals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`public.uuidv7()`),
    moderationActionId: uuid("moderation_action_id")
      .notNull()
      .references(() => moderationActions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    reviewerAdminId: uuid("reviewer_admin_id"),
    decisionRationale: text("decision_rationale"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("chk_appeal_status", sql`${table.status} IN ('pending','upheld','overturned')`),
    index("idx_appeals_queue")
      .on(table.status, table.slaDueAt)
      .where(sql`${table.status} = 'pending'`),
    index("idx_appeals_action").on(table.moderationActionId),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type NewModerationAction = typeof moderationActions.$inferInsert;
export type ModerationActionApproval = typeof moderationActionApprovals.$inferSelect;
export type Appeal = typeof appeals.$inferSelect;
export type NewAppeal = typeof appeals.$inferInsert;
