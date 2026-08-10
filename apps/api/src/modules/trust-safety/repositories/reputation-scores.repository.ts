import { reputationScores, users, type ReputationScore } from "@convene/db";
import type { ReputationResult } from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

@Injectable()
export class ReputationScoresRepository {
  constructor(private readonly postgres: PostgresService) {}

  async upsert(userId: string, result: ReputationResult): Promise<ReputationScore> {
    const [row] = await this.postgres.db
      .insert(reputationScores)
      .values({
        userId,
        score: Math.round(result.score),
        band: result.band,
        components: result.components,
        computedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: reputationScores.userId,
        set: {
          score: Math.round(result.score),
          band: result.band,
          components: result.components,
          computedAt: sql`now()`,
        },
      })
      .returning();
    if (!row) throw new Error("ReputationScoresRepository: upsert returned no row");
    return row;
  }

  async findById(userId: string): Promise<ReputationScore | null> {
    const [row] = await this.postgres.db
      .select()
      .from(reputationScores)
      .where(eq(reputationScores.userId, userId))
      .limit(1);
    return row ?? null;
  }

  // The nightly sweep's user set — every non-deleted account. Paged by
  // the caller (ReputationRecomputeWorker) rather than loaded all at
  // once, same "sweep in batches" precedent as availability-expiry and
  // connection-request-expiry's own workers.
  async listUserIdsBatch(afterId: string | null, limit: number): Promise<string[]> {
    const rows = await this.postgres.db
      .select({ id: users.id })
      .from(users)
      .where(
        afterId
          ? sql`${users.id} > ${afterId} AND ${users.status} != 'deleted'`
          : sql`${users.status} != 'deleted'`,
      )
      .orderBy(users.id)
      .limit(limit);
    return rows.map((row) => row.id);
  }
}
