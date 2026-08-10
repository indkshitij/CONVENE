import { feedImpressions, matchSuppressions } from "@convene/db";
import {
  fatigueMultiplier,
  scoreBand,
  shouldAutoSuppress,
  FATIGUE_SUPPRESSION_DAYS,
} from "@convene/matching";
import { Injectable, Optional } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Clock, systemClock } from "../../../common/clock";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface ImpressionRecord {
  candidateId: string;
  expansionStage: number;
  score: number;
}

// PRD §11.8: "feed_impressions(viewer_id, candidate_id, count,
// last_shown_at)." Owns the fatigue half of ranking: recordImpressions()
// is called once per served page (matching.service.ts), and its own
// auto-suppress side effect is BR-11.8's "after 8 impressions with no
// interaction, suppress for 14 days" — reusing match_suppressions (the
// same table G3 already gates on) rather than inventing a parallel
// mechanism.
@Injectable()
export class FeedImpressionsService {
  constructor(
    private readonly postgres: PostgresService,
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  async getFatigueMultipliers(
    viewerId: string,
    candidateIds: readonly string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (candidateIds.length === 0) return result;

    const rows = await this.postgres.db
      .select({ candidateId: feedImpressions.candidateId, count: feedImpressions.count })
      .from(feedImpressions)
      .where(
        and(
          eq(feedImpressions.userId, viewerId),
          inArray(feedImpressions.candidateId, candidateIds as string[]),
        ),
      );

    for (const row of rows) result.set(row.candidateId, fatigueMultiplier(row.count));
    for (const id of candidateIds) if (!result.has(id)) result.set(id, 1.0); // never shown before -> no fatigue.
    return result;
  }

  // Called once per served page, after diversity injection — recording an
  // impression for every candidate actually shown, not every candidate
  // scored (a deferred/never-shown candidate shouldn't accrue fatigue).
  // PRD §11.11: "Record impressions with the expansion stage and score
  // band" for the fairness audit query — both columns reflect the most
  // recent impression (like a snapshot), not a history; count is what
  // stays cumulative.
  async recordImpressions(viewerId: string, records: readonly ImpressionRecord[]): Promise<void> {
    if (records.length === 0) return;
    const now = this.clock.now();

    for (const record of records) {
      const band = scoreBand(record.score);
      await this.postgres.db
        .insert(feedImpressions)
        .values({
          userId: viewerId,
          candidateId: record.candidateId,
          count: 1,
          interacted: false,
          lastShownAt: now,
          expansionStage: record.expansionStage,
          scoreBand: band,
        })
        .onConflictDoUpdate({
          target: [feedImpressions.userId, feedImpressions.candidateId],
          set: {
            count: sql`${feedImpressions.count} + 1`,
            lastShownAt: now,
            expansionStage: record.expansionStage,
            scoreBand: band,
          },
        });
    }

    await this.autoSuppressFatigued(
      viewerId,
      records.map((r) => r.candidateId),
      now,
    );
  }

  // No caller exists yet — connection requests (the interaction this
  // flag exists to detect) are Phase 14. Built now so that phase only
  // needs to call this, not touch feed_impressions' schema or this
  // service's shape.
  async markInteracted(viewerId: string, candidateId: string): Promise<void> {
    await this.postgres.db
      .update(feedImpressions)
      .set({ interacted: true })
      .where(
        and(eq(feedImpressions.userId, viewerId), eq(feedImpressions.candidateId, candidateId)),
      );
  }

  private async autoSuppressFatigued(
    viewerId: string,
    candidateIds: readonly string[],
    now: Date,
  ): Promise<void> {
    const rows = await this.postgres.db
      .select({
        candidateId: feedImpressions.candidateId,
        count: feedImpressions.count,
        interacted: feedImpressions.interacted,
      })
      .from(feedImpressions)
      .where(
        and(
          eq(feedImpressions.userId, viewerId),
          inArray(feedImpressions.candidateId, candidateIds as string[]),
        ),
      );

    const toSuppress = rows.filter((row) => shouldAutoSuppress(row.count, row.interacted));
    if (toSuppress.length === 0) return;

    const expiresAt = new Date(now.getTime() + FATIGUE_SUPPRESSION_DAYS * 86_400_000);
    for (const row of toSuppress) {
      await this.postgres.db
        .insert(matchSuppressions)
        .values({
          userId: viewerId,
          suppressedId: row.candidateId,
          reason: "fatigue_no_interaction",
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [matchSuppressions.userId, matchSuppressions.suppressedId],
          set: { expiresAt, reason: "fatigue_no_interaction" },
        });
    }
  }
}
