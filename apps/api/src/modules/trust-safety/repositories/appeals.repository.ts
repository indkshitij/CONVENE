import { appeals, type Appeal, type NewAppeal } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface CreateAppealInput {
  moderationActionId: string;
  userId: string;
  reason: string;
  slaDueAt: Date;
}

@Injectable()
export class AppealsRepository {
  constructor(private readonly postgres: PostgresService) {}

  async create(input: CreateAppealInput): Promise<Appeal> {
    const values: NewAppeal = {
      moderationActionId: input.moderationActionId,
      userId: input.userId,
      reason: input.reason,
      status: "pending",
      slaDueAt: input.slaDueAt,
    };
    const [row] = await this.postgres.db.insert(appeals).values(values).returning();
    if (!row) throw new Error("AppealsRepository: create returned no row");
    return row;
  }

  async findById(id: string): Promise<Appeal | null> {
    const [row] = await this.postgres.db.select().from(appeals).where(eq(appeals.id, id)).limit(1);
    return row ?? null;
  }

  // P26.1: the appeals review queue needs a list, same gap as
  // ModerationActionsRepository — only single-id lookups existed before.
  async list(filter: { status?: string | undefined }, limit: number): Promise<Appeal[]> {
    const conditions = [];
    if (filter.status) conditions.push(eq(appeals.status, filter.status));
    return this.postgres.db
      .select()
      .from(appeals)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(appeals.slaDueAt))
      .limit(limit);
  }

  async decide(
    id: string,
    decision: "upheld" | "overturned",
    reviewerAdminId: string,
    rationale: string,
    now: Date,
  ): Promise<Appeal | null> {
    const [row] = await this.postgres.db
      .update(appeals)
      .set({ status: decision, reviewerAdminId, decisionRationale: rationale, decidedAt: now })
      .where(eq(appeals.id, id))
      .returning();
    return row ?? null;
  }
}
