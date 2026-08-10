import type { ReputationScore } from "@convene/db";
import { computeReputation } from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { ReputationDataRepository } from "../repositories/reputation-data.repository";
import { ReputationScoresRepository } from "../repositories/reputation-scores.repository";

const RECOMPUTE_BATCH_SIZE = 500;

// P18.2 (§10.10.1): the only place that wires the pure
// packages/matching/src/reputation.ts formula to real data — gather raw
// metrics, run the pure computation, persist. "Recomputed nightly and on
// significant events": the nightly sweep is
// workers/reputation-recompute.worker.ts; recomputeForUser is also the
// hook a future significant-event trigger (accepted request, upheld
// report, etc.) would call, though nothing in this codebase calls it
// on-demand yet — flagged as a gap, not wired to avoid touching every
// other module's business logic in this one prompt (CLAUDE.md scope
// discipline).
@Injectable()
export class ReputationService {
  constructor(
    private readonly dataRepo: ReputationDataRepository,
    private readonly scoresRepo: ReputationScoresRepository,
  ) {}

  async recomputeForUser(userId: string): Promise<ReputationScore> {
    const input = await this.dataRepo.gatherInputFor(userId);
    const result = computeReputation(input);
    return this.scoresRepo.upsert(userId, result);
  }

  // Called by the worker in pages of RECOMPUTE_BATCH_SIZE user ids;
  // returns the last id seen (or null once exhausted) so the worker can
  // resume its own paging loop.
  async recomputeBatch(afterId: string | null): Promise<{ lastId: string | null; count: number }> {
    const userIds = await this.scoresRepo.listUserIdsBatch(afterId, RECOMPUTE_BATCH_SIZE);
    for (const userId of userIds) {
      await this.recomputeForUser(userId);
    }
    const lastId = userIds.length > 0 ? userIds[userIds.length - 1]! : null;
    return { lastId, count: userIds.length };
  }
}
