import {
  moderationActionApprovals,
  moderationActions,
  users,
  type ModerationAction,
  type ModerationActionApproval,
  type NewModerationAction,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface CreateModerationActionInput {
  targetUserId: string | null;
  reportId: string | null;
  adminId: string | null;
  action: string;
  policyClause: string;
  rationale: string;
  status: "pending_approval" | "active";
  expiresAt: Date | null;
}

@Injectable()
export class ModerationActionsRepository {
  constructor(private readonly postgres: PostgresService) {}

  async create(input: CreateModerationActionInput): Promise<ModerationAction> {
    const values: NewModerationAction = {
      targetUserId: input.targetUserId,
      reportId: input.reportId,
      adminId: input.adminId,
      action: input.action,
      policyClause: input.policyClause,
      rationale: input.rationale,
      status: input.status,
      expiresAt: input.expiresAt,
    };
    const [row] = await this.postgres.db.insert(moderationActions).values(values).returning();
    if (!row) throw new Error("ModerationActionsRepository: create returned no row");
    return row;
  }

  async findById(id: string): Promise<ModerationAction | null> {
    const [row] = await this.postgres.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, id))
      .limit(1);
    return row ?? null;
  }

  // P26.1: the ban-approval queue (§10.10.3's "two-admin approval") needs
  // a way to list the actions actually awaiting a second admin — no
  // endpoint surfaced that before this, only apply()/approve() acting on
  // one id at a time.
  async list(filter: { status?: string | undefined }, limit: number): Promise<ModerationAction[]> {
    const conditions = [];
    if (filter.status) conditions.push(eq(moderationActions.status, filter.status));
    return this.postgres.db
      .select()
      .from(moderationActions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(moderationActions.createdAt))
      .limit(limit);
  }

  async activate(id: string): Promise<ModerationAction | null> {
    const [row] = await this.postgres.db
      .update(moderationActions)
      .set({ status: "active" })
      .where(eq(moderationActions.id, id))
      .returning();
    return row ?? null;
  }

  async reverse(id: string, reversedBy: string, now: Date): Promise<ModerationAction | null> {
    const [row] = await this.postgres.db
      .update(moderationActions)
      .set({ status: "reversed", reversedBy, reversedAt: now })
      .where(eq(moderationActions.id, id))
      .returning();
    return row ?? null;
  }

  // BR-SAFE-01 (§10.10.3): the unique constraint on (moderation_action_id,
  // admin_id) — not just this check — is what makes double-approval by
  // the same admin structurally impossible; a duplicate insert throws,
  // which the service maps to ALREADY_APPROVED.
  async addApproval(
    moderationActionId: string,
    adminId: string,
    rationale: string,
  ): Promise<ModerationActionApproval> {
    const [row] = await this.postgres.db
      .insert(moderationActionApprovals)
      .values({ moderationActionId, adminId, rationale })
      .returning();
    if (!row) throw new Error("ModerationActionsRepository: addApproval returned no row");
    return row;
  }

  async listApprovals(moderationActionId: string): Promise<ModerationActionApproval[]> {
    return this.postgres.db
      .select()
      .from(moderationActionApprovals)
      .where(eq(moderationActionApprovals.moderationActionId, moderationActionId));
  }

  async setUserStatus(
    userId: string,
    status: "active" | "restricted" | "shadow_limited" | "suspended",
  ): Promise<void> {
    await this.postgres.db.update(users).set({ status }).where(eq(users.id, userId));
  }
}
