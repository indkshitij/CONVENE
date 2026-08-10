import { auditLogs, type AuditLog, type NewAuditLog } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { PostgresService } from "../../infra/postgres/postgres.service";

export interface RecordAuditLogInput {
  actorId: string | null;
  actorType: "admin" | "system" | "user";
  action: string;
  entityType: string;
  entityId: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ListAuditLogFilters {
  actorId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  requestId?: string | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
}

// §20.8: append-only writer for audit_logs. No update/delete method
// exists on this class at all (not merely "unused" — structurally
// absent), mirroring the DB grant itself (migrations/0003's REVOKE
// UPDATE, DELETE ON audit_logs FROM convene_app) so a future caller
// can't even find a method that would violate it.
@Injectable()
export class AuditLogRepository {
  constructor(private readonly postgres: PostgresService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    const values: NewAuditLog = {
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    };
    await this.postgres.db.insert(auditLogs).values(values);
  }

  async list(filters: ListAuditLogFilters, limit: number): Promise<AuditLog[]> {
    const conditions = [];
    if (filters.actorId) conditions.push(eq(auditLogs.actorId, filters.actorId));
    if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
    if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
    if (filters.requestId) conditions.push(eq(auditLogs.requestId, filters.requestId));
    if (filters.since) conditions.push(gte(auditLogs.createdAt, filters.since));
    if (filters.until) conditions.push(lte(auditLogs.createdAt, filters.until));

    return this.postgres.db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  // BR-SAFE-02 (this phase's own name): "how many audit-log reads has
  // this admin made in the last N minutes" — the raw signal
  // AuditLogService's anomaly check runs against, not a decision itself.
  async countRecentReadsByActor(actorId: string, since: Date): Promise<number> {
    const rows = await this.postgres.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actorId, actorId),
          eq(auditLogs.action, "audit_log.accessed"),
          gte(auditLogs.createdAt, since),
        ),
      );
    return rows.length;
  }
}
