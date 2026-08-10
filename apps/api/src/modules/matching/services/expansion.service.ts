import { profiles } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { NotFoundAppError } from "../../../common/errors/app-error";
import { CacheService } from "../../../common/cache/cache.service";
import { matchingExpansionStage } from "../../../infra/telemetry/metrics";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import {
  CandidateRepository,
  type CandidateRow,
  type ViewerLocationContext,
} from "../repositories/candidate.repository";

// PRD §10.5.5: "the feed needs TARGET_CANDIDATES = 40 scored candidates
// above the intent floor to produce a good page of 20."
export const TARGET_CANDIDATES = 40;
// Stage 5's own flowchart node checks a lower floor ("count >= 15?") before
// falling through to the cold-start fallback (§11.9, not this phase's scope).
const STAGE_5_TARGET = 15;
const EXPANSION_CACHE_TTL_SECONDS = 90; // RE-4

// §10.5.5 flowchart's own labels (Z1..Z6) — RE-5's "labelled section
// headers" so scope escalation is never silent.
const STAGE_LABELS = [
  "Nearby",
  "Extended",
  "In your city",
  "In your state",
  "In your country",
  "Worldwide",
] as const;

export interface ExpansionResult {
  candidates: CandidateRow[];
  /** Highest stage reached (0-5) — §10.5.5 RE-3's expansion_stage. */
  stage: number;
  /** One label per stage actually run, in order — RE-7: scope escalation is never silent. */
  labels: string[];
  /** True when a Premium user's pinned_tier (RE-6) was used instead of auto-expansion. */
  pinned: boolean;
}

// PRD §10.5.5. Stages append (RE-1) — a stage's own results are only ever
// added to, never substituted for, the previous stages' results, so
// array position alone keeps nearer candidates ranked ahead of farther
// ones (the "explicit tie-break on location tier" RE-1 requires, ahead of
// any scoring pipeline — P12/P13 — which doesn't exist yet to break ties
// on total score).
@Injectable()
export class ExpansionService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly candidateRepository: CandidateRepository,
    private readonly cache: CacheService,
  ) {}

  async expand(viewerId: string, requestedRadiusKm: number): Promise<ExpansionResult> {
    // RE-4: "Results are cached per (viewer, filter-hash, stage) for 90s."
    // No other filters exist yet on this endpoint (search/industry filters
    // are a later phase), so the cache key is just (viewer, radius) today
    // — extend the key, don't replace this mechanism, once filters exist.
    const cacheKey = `expansion:${viewerId}:${requestedRadiusKm}`;
    return this.cache.getOrSet(cacheKey, EXPANSION_CACHE_TTL_SECONDS, () =>
      this.computeExpansion(viewerId, requestedRadiusKm),
    );
  }

  private async computeExpansion(
    viewerId: string,
    requestedRadiusKm: number,
  ): Promise<ExpansionResult> {
    const ctx = await this.candidateRepository.resolveViewerContext(viewerId);
    if (!ctx) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");
    const radiusM = requestedRadiusKm * 1000;

    const [profile] = await this.postgres.db
      .select({ pinnedTier: profiles.pinnedTier })
      .from(profiles)
      .where(eq(profiles.userId, viewerId))
      .limit(1);

    // RE-6: "Premium users may pin a stage ... expansion becomes manual."
    if (profile?.pinnedTier != null) {
      const candidates = await this.runStage(profile.pinnedTier, ctx, radiusM);
      this.recordMetric(ctx.cityId, profile.pinnedTier);
      return {
        candidates,
        stage: profile.pinnedTier,
        labels: [STAGE_LABELS[profile.pinnedTier]!],
        pinned: true,
      };
    }

    const seen = new Set<string>();
    const appended: CandidateRow[] = [];
    const labels: string[] = [];
    let stageReached = 0;

    for (let stage = 0; stage <= 5; stage++) {
      const rows = await this.runStage(stage, ctx, radiusM);
      const newRows = rows.filter((r) => !seen.has(r.userId));
      for (const r of newRows) seen.add(r.userId);
      appended.push(...newRows); // RE-1: append, never replace.
      labels.push(STAGE_LABELS[stage]!);
      stageReached = stage;

      const target = stage === 5 ? STAGE_5_TARGET : TARGET_CANDIDATES;
      if (appended.length >= target) break;
    }

    this.recordMetric(ctx.cityId, stageReached);
    return { candidates: appended, stage: stageReached, labels, pinned: false };
  }

  private runStage(
    stage: number,
    ctx: ViewerLocationContext,
    radiusM: number,
  ): Promise<CandidateRow[]> {
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
        throw new Error(`ExpansionService: invalid stage ${stage}`);
    }
  }

  private recordMetric(cityId: number | null, stage: number): void {
    matchingExpansionStage.observe(
      { city_id: cityId === null ? "unknown" : String(cityId) },
      stage,
    );
  }
}
