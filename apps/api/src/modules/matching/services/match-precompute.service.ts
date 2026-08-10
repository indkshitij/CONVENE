import { matchCandidates } from "@convene/db";
import { Injectable, Logger, Optional } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { type Clock, systemClock } from "../../../common/clock";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import {
  CandidateRepository,
  type ViewerLocationContext,
} from "../repositories/candidate.repository";
import { MatchingDataRepository } from "../repositories/matching-data.repository";
import { StaticComponentsService } from "./static-components.service";

// PRD §11.7 O1: "For each active user: generate 300 candidate ids." Wider
// than ExpansionService's own TARGET_CANDIDATES=40 (the online request's
// live recall target) — this is the offline batch, building a deep bench
// of precomputed static components so the online path rarely needs its
// cold-start live-compute fallback.
export const PRECOMPUTE_TARGET_CANDIDATES = 300;
const STAGE_5_TARGET = 100;
// Bounded so a hot hour doesn't open hundreds of simultaneous connections
// against the pool — each pair's StaticComponentsService.compute() issues
// several queries of its own.
const COMPUTE_CONCURRENCY = 10;

export interface PrecomputeResult {
  candidatesConsidered: number;
  written: number;
}

@Injectable()
export class MatchPrecomputeService {
  private readonly logger = new Logger(MatchPrecomputeService.name);

  constructor(
    private readonly postgres: PostgresService,
    private readonly candidateRepository: CandidateRepository,
    private readonly dataRepository: MatchingDataRepository,
    private readonly staticComponents: StaticComponentsService,
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  async precomputeForUser(userId: string): Promise<PrecomputeResult> {
    const ctx = await this.candidateRepository.resolveViewerContext(userId);
    if (!ctx) return { candidatesConsidered: 0, written: 0 };

    const candidateIds = await this.gatherCandidateIds(ctx);
    if (candidateIds.length === 0) return { candidatesConsidered: 0, written: 0 };

    const rows: (typeof matchCandidates.$inferInsert)[] = [];
    await mapWithConcurrency(candidateIds, COMPUTE_CONCURRENCY, async (candidateId) => {
      try {
        const { components, staticScore } = await this.staticComponents.compute(
          userId,
          candidateId,
        );
        rows.push({
          userId,
          candidateId,
          staticScore: staticScore.toFixed(4),
          components,
          computedAt: this.clock.now(),
        });
      } catch (error) {
        this.logger.error(
          `Failed to compute static components for ${userId} -> ${candidateId}`,
          error,
        );
      }
    });

    if (rows.length > 0) await this.upsert(rows);
    return { candidatesConsidered: candidateIds.length, written: rows.length };
  }

  async precomputeForAllActiveUsers(): Promise<{ users: number; written: number }> {
    const userIds = await this.dataRepository.loadActiveUserIds();
    let written = 0;
    for (const userId of userIds) {
      const result = await this.precomputeForUser(userId);
      written += result.written;
    }
    return { users: userIds.length, written };
  }

  // Same staged-expansion shape as ExpansionService (§10.5.5), but with no
  // 90s cache (this IS the cache's own source of truth) and a much wider
  // target — the offline job can afford the extra stage-5 breadth that the
  // online request's 90s SLA can't.
  private async gatherCandidateIds(ctx: ViewerLocationContext): Promise<string[]> {
    const seen = new Set<string>();
    const radiusM = 25_000; // a reasonable default recall radius for the batch job — RE-6 pinning is a per-request preference, not meaningful for a background precompute pass.

    for (let stage = 0; stage <= 5; stage++) {
      const rows = await this.runStage(stage, ctx, radiusM);
      for (const row of rows) seen.add(row.userId);

      const target = stage === 5 ? STAGE_5_TARGET : PRECOMPUTE_TARGET_CANDIDATES;
      if (seen.size >= target) break;
    }
    return [...seen];
  }

  private runStage(stage: number, ctx: ViewerLocationContext, radiusM: number) {
    switch (stage) {
      case 0:
        return this.candidateRepository.stage0(ctx, radiusM);
      case 1:
        return this.candidateRepository.stage1(ctx, radiusM);
      case 2:
        return this.candidateRepository.stage2(ctx);
      case 3:
        return this.candidateRepository.stage3(ctx);
      case 4:
        return this.candidateRepository.stage4(ctx);
      case 5:
        return this.candidateRepository.stage5(ctx);
      default:
        throw new Error(`MatchPrecomputeService: invalid stage ${stage}`);
    }
  }

  private async upsert(rows: (typeof matchCandidates.$inferInsert)[]): Promise<void> {
    await this.postgres.db
      .insert(matchCandidates)
      .values(rows)
      .onConflictDoUpdate({
        target: [matchCandidates.userId, matchCandidates.candidateId],
        set: {
          staticScore: sql`excluded.static_score`,
          components: sql`excluded.components`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = items[index++]!;
      await fn(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}
