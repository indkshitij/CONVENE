import {
  bigint,
  bigserial,
  index,
  inet,
  jsonb,
  pgMaterializedView,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// PRD §16.3 "SAFETY & AUDIT" (audit_logs) — mirrors
// migrations/0003_matching_safety_billing_audit.sql exactly. Append-only:
// the `convene_app` role has no UPDATE/DELETE grant on this table (enforced
// in the migration, not here — this is a typed query mirror only).
//
// PK is composite (id, created_at), not `id` alone — the PRD's own DDL gives
// a single-column PK on a table that's also PARTITION BY RANGE (created_at),
// which Postgres rejects. See the migration for the full explanation.
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    actorId: uuid("actor_id"),
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    reason: text("reason"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt] }),
    index("idx_audit_entity").on(table.entityType, table.entityId, table.createdAt.desc()),
  ],
);

// §16.4 — created via raw SQL in the migration (a directed helper view over
// connections); `.existing()` tells drizzle not to try to manage its DDL.
export const connectionEdges = pgView("connection_edges", {
  userId: uuid("user_id"),
  peerId: uuid("peer_id"),
}).existing();

// §16.4 — refreshed CONCURRENTLY hourly; requires the unique index the
// migration creates on (u1, u2).
export const mutualConnectionCounts = pgMaterializedView("mutual_connection_counts", {
  u1: uuid("u1"),
  u2: uuid("u2"),
  mutualCount: bigint("mutual_count", { mode: "number" }),
}).existing();

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
