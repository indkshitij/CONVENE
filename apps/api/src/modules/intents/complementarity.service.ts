import { intentComplementarity } from "@convene/db";
import { intentScore, type IntentRef, type IntentScoreOptions } from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { CacheService } from "../../common/cache/cache.service";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { buildMatrixFromRows, findBestPair, type BestPair } from "./complementarity-matrix";

const MATRIX_CACHE_KEY = "intent_complementarity_matrix";
const MATRIX_CACHE_TTL_SECONDS = 5 * 60;

// PRD P8.2: "The complementarity service loads the asymmetric 14×14
// matrix into an in-process LRU (5min) and exposes bestPair() and
// score()." Reuses CacheService (P6.1's own in-process-LRU-then-Redis
// layer, same one TaxonomyService uses) rather than building a second
// caching mechanism.
@Injectable()
export class ComplementarityService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly cache: CacheService,
  ) {}

  async getMatrix() {
    return this.cache.getOrSet(MATRIX_CACHE_KEY, MATRIX_CACHE_TTL_SECONDS, async () => {
      const rows = await this.postgres.db.select().from(intentComplementarity);
      return buildMatrixFromRows(rows);
    });
  }

  // Delegates the actual scoring math to packages/matching's intentScore
  // (best-pair dominance, multi-pair bonus, primary multiplier, etc.) —
  // this service's only job is supplying the DB-backed matrix instead of
  // the code-level default.
  async score(
    viewerIntents: readonly IntentRef[],
    candidateIntents: readonly IntentRef[],
    options: Omit<IntentScoreOptions, "matrix"> = {},
  ): Promise<number> {
    const matrix = await this.getMatrix();
    return intentScore(viewerIntents, candidateIntents, { ...options, matrix });
  }

  async bestPair(
    viewerIntents: readonly IntentRef[],
    candidateIntents: readonly IntentRef[],
  ): Promise<BestPair | null> {
    const matrix = await this.getMatrix();
    return findBestPair(viewerIntents, candidateIntents, matrix);
  }
}
