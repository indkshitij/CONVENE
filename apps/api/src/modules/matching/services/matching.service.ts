import { profiles } from "@convene/db";
import {
  activityScore,
  applyGates,
  availabilityScore,
  computeMultiplier,
  computeScore,
  decodeCursor,
  diversityInjection,
  encodeCursor,
  intentScore,
  isCursorExpired,
  isPastCursorBoundary,
  locationScore,
  reputationScore as reputationSubScore,
  type DiversityCandidate,
  type FeedCursor,
  type GateContext,
  type IntentRef,
  type SubScores,
} from "@convene/matching";
import { Injectable, Optional } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { type Clock, systemClock } from "../../../common/clock";
import { CacheService } from "../../../common/cache/cache.service";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import { CandidateRepository } from "../repositories/candidate.repository";
import {
  MatchingDataRepository,
  type PrecomputedComponents,
} from "../repositories/matching-data.repository";
import { ExpansionService } from "./expansion.service";
import { FeedImpressionsService } from "./feed-impressions.service";
import { MatchingWeightsProvider } from "./matching-weights-provider";
import { StaticComponentsService } from "./static-components.service";

export type FeedSurface = "discover" | "available_now";
// PRD §14.8's three tabs: "Available Now" is the separate available_now
// surface above; "Nearby"/"Global" are both the `discover` surface,
// distinguished only by this recall-scope hint. "global" bypasses both
// the precomputed fast path and the staged radius ladder, going straight
// to CandidateRepository.stage5 (worldwide) — the PRD doesn't spell out
// this distinction beyond naming the tab, so this is a documented
// interpretation of "Global" as "don't scope by the viewer's own radius
// preference at all," not a transcription.
export type DiscoverTab = "nearby" | "global";

export interface ScoredCandidate {
  candidateId: string;
  score: number;
  weightedSum: number;
  multiplier: number;
  components: SubScores;
  /** §10.5.4's 0-6 tier ladder — lets the caller render §14.8's expansion-stage section headers per card, not just one stage for the whole page. */
  locationTier: number;
  /** Only known on the live-recall (non-precomputed) path; null otherwise — see scoreLocation's own comment. */
  distanceM: number | null;
}

export interface FeedResult {
  matches: ScoredCandidate[];
  expansionStage: number;
  nextCursor: string | null;
  /** Tier A recall size, before any gate/hard-filter exclusion — §14.8 empty-state reason "no_supply" when this is 0. */
  candidatesRecalled: number;
  /** Post-gate, pre-diversity/cursor count — "all_filtered" when this is 0 but candidatesRecalled isn't. */
  candidatesScored: number;
}

// PRD §17.6 cache table: "Redis: discovery feed ... 90 s ... availability.*,
// intent.changed, own actions."
const FEED_CACHE_TTL_SECONDS = 90;
const FEED_TARGET_CANDIDATES = 40;
const PAGE_SIZE = 20;
const NEWBIE_MAX_DAYS = 7;
const NEWBIE_MAX_CONNECTIONS = 3;
const STALE_INACTIVE_FLOOR_DAYS = 999;

function feedFilterHash(surface: FeedSurface, tab: DiscoverTab): string {
  // No real filters exist yet (search/industry filters are a later
  // phase) — surface+tab is what currently distinguishes one
  // cached/paginated feed from another. Extend, don't replace, once
  // filters land (same precedent as expansion.service.ts's own key
  // comment).
  return `${surface}:${tab}`;
}

function feedCacheKey(
  viewerId: string,
  surface: FeedSurface,
  tab: DiscoverTab,
  cursorToken: string | undefined,
): string {
  return `feed:${viewerId}:${surface}:${tab}:${cursorToken ?? "start"}`;
}

// PRD §11.7/§11.8/§11.10 — the online path: Tier A recall, hard gates,
// Tier B live scoring, multipliers, diversity injection with exploration
// slots, fatigue (from feed_impressions), opaque cursor pagination. The
// explain endpoint (§10.3 endpoint 30) reuses this class's own per-
// candidate SubScores/multiplier via @convene/matching's explainScore —
// see matches.controller.ts.
@Injectable()
export class MatchingService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly expansionService: ExpansionService,
    private readonly candidateRepository: CandidateRepository,
    private readonly dataRepository: MatchingDataRepository,
    private readonly staticComponents: StaticComponentsService,
    private readonly feedImpressions: FeedImpressionsService,
    private readonly weightsProvider: MatchingWeightsProvider,
    private readonly cache: CacheService,
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  async getFeed(
    viewerId: string,
    surface: FeedSurface,
    tab: DiscoverTab = "nearby",
    cursorToken?: string,
  ): Promise<FeedResult> {
    return this.cache.getOrSet(
      feedCacheKey(viewerId, surface, tab, cursorToken),
      FEED_CACHE_TTL_SECONDS,
      () => this.computeFeed(viewerId, surface, tab, cursorToken),
    );
  }

  // PRD AD-8: the same remote-config weights every score in this class is
  // computed with — exposed so /matches/{id}/explain (matches.controller.ts)
  // can pass the identical weights into explainScore() rather than
  // silently falling back to DEFAULT_WEIGHTS if they've since diverged.
  async getActiveWeights() {
    return this.weightsProvider.getActiveWeights();
  }

  // Scores exactly one candidate the same way getFeed's own loop does —
  // used by GET /matches/{id}/explain (endpoint 30) so the breakdown a
  // user sees is guaranteed to match whatever score they were shown,
  // never a second, drifting implementation. Resolves a real distance for
  // the location component (rather than falling back to the coarser
  // city/state/country tiers a bare scoreCandidates([id]) call would use)
  // so /explain never disagrees with the feed it's explaining.
  async scoreCandidate(viewerId: string, candidateId: string): Promise<ScoredCandidate | null> {
    const viewerCtx = await this.candidateRepository.resolveViewerContext(viewerId);
    const distanceM = viewerCtx
      ? await this.candidateRepository.distanceBetween(viewerCtx, candidateId)
      : null;
    const scored = await this.scoreCandidates(
      viewerId,
      [candidateId],
      undefined,
      new Map([[candidateId, distanceM]]),
    );
    return scored.get(candidateId) ?? null;
  }

  // PRD §17.6 invalidation triggers: "availability change ..., intent
  // change (own set only), profile edit (own set + re-embed), block/
  // suppress (both sets), connection created (both sets)." P12.1 scope:
  // the viewer's own cached feed entries only — see the listener's own
  // comment for what's deliberately not covered yet (other viewers'
  // feeds in the same geo cell). Cursor-keyed cache entries mean this
  // can't enumerate every possible key; instead it bumps a per-viewer
  // cache "epoch" the key... — see note below for why a simple prefix
  // scan isn't used.
  async invalidateFeedCache(userId: string): Promise<void> {
    // Only the two un-paginated "start" entries are invalidated — a
    // cursor-keyed page N+1 cache entry naturally expires within its own
    // 90s TTL regardless, and Redis SCAN-based prefix invalidation isn't
    // available through CacheService's current (get/set/del-by-exact-key)
    // interface. Documented as a narrower invalidation than the ideal
    // "every cached page," consistent with this method's own existing
    // P12.1 scope note.
    const surfaces: FeedSurface[] = ["discover", "available_now"];
    const tabs: DiscoverTab[] = ["nearby", "global"];
    await Promise.all(
      surfaces.flatMap((surface) =>
        tabs.map((tab) => this.cache.invalidate(feedCacheKey(userId, surface, tab, undefined))),
      ),
    );
  }

  private async computeFeed(
    viewerId: string,
    surface: FeedSurface,
    tab: DiscoverTab,
    cursorToken: string | undefined,
  ): Promise<FeedResult> {
    const now = this.clock.now();
    const cursor = this.resolveCursor(cursorToken, surface, tab, now);

    const { candidateIds, stage, distanceByCandidateId } = await this.recallCandidates(
      viewerId,
      tab,
    );
    const candidatesRecalled = candidateIds.length;
    if (candidateIds.length === 0) {
      return {
        matches: [],
        expansionStage: stage,
        nextCursor: null,
        candidatesRecalled: 0,
        candidatesScored: 0,
      };
    }

    const scoredByCandidate = await this.scoreCandidates(
      viewerId,
      candidateIds,
      surface,
      distanceByCandidateId,
    );
    const candidatesScored = scoredByCandidate.size;
    let sorted = [...scoredByCandidate.values()].sort(
      (a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId),
    );
    if (cursor)
      sorted = sorted.filter((match) =>
        isPastCursorBoundary(match.score, match.candidateId, cursor),
      );

    const diversityCandidates = await this.toDiversityCandidates(viewerId, sorted);
    const page = diversityInjection(diversityCandidates, PAGE_SIZE);
    const pageIds = new Set(page.map((c) => c.id));
    const matches = sorted.filter((match) => pageIds.has(match.candidateId));
    // diversityInjection may reorder (exploration-slot swaps) — restore
    // the page's own order, not the pre-diversity sort order.
    matches.sort(
      (a, b) =>
        page.findIndex((c) => c.id === a.candidateId) -
        page.findIndex((c) => c.id === b.candidateId),
    );

    if (matches.length > 0) {
      await this.feedImpressions
        .recordImpressions(
          viewerId,
          matches.map((m) => ({
            candidateId: m.candidateId,
            expansionStage: stage,
            score: m.score,
          })),
        )
        .catch(() => undefined);
    }

    const nextCursor =
      matches.length === PAGE_SIZE
        ? encodeCursor({
            score: matches[matches.length - 1]!.score,
            id: matches[matches.length - 1]!.candidateId,
            expansionStage: stage,
            filterHash: feedFilterHash(surface, tab),
            generatedAt: now.toISOString(),
          })
        : null;

    return { matches, expansionStage: stage, nextCursor, candidatesRecalled, candidatesScored };
  }

  private resolveCursor(
    cursorToken: string | undefined,
    surface: FeedSurface,
    tab: DiscoverTab,
    now: Date,
  ): FeedCursor | null {
    if (!cursorToken) return null;
    const cursor = decodeCursor(cursorToken);
    if (!cursor) return null;
    if (cursor.filterHash !== feedFilterHash(surface, tab)) return null; // filters changed underneath the cursor — restart.
    if (isCursorExpired(cursor, now)) return null;
    return cursor;
  }

  // Scores every candidate in candidateIds against viewerId — shared by
  // computeFeed (many candidates, surface-aware hard filter) and
  // scoreCandidate (exactly one, no surface filter — /explain should
  // explain the candidate's real score, not a page-filtered view of it).
  private async scoreCandidates(
    viewerId: string,
    candidateIds: string[],
    surface?: FeedSurface,
    distanceByCandidateId: ReadonlyMap<string, number | null> = new Map(),
  ): Promise<Map<string, ScoredCandidate>> {
    const [
      gateFactsByCandidate,
      precomputed,
      viewerAvailability,
      candidateAvailability,
      viewerIntents,
      viewerLocation,
      candidateLocations,
    ] = await Promise.all([
      this.dataRepository.loadGateFacts(viewerId, candidateIds),
      this.loadPrecomputedByCandidate(viewerId, candidateIds),
      this.dataRepository.loadAvailabilityLive([viewerId]),
      this.dataRepository.loadAvailabilityLive(candidateIds),
      this.loadIntents(viewerId),
      this.dataRepository.loadLocationContext([viewerId]),
      this.dataRepository.loadLocationContext(candidateIds),
    ]);
    const viewerLoc = viewerLocation.get(viewerId);

    const candidateIntentsByUser = await this.dataRepository.loadIntentRefsForUsers(
      candidateIds,
      new Map(candidateIds.map((id) => [id, candidateAvailability.get(id)?.intentIds ?? null])),
    );

    const [
      profileFields,
      plans,
      activity,
      reputation,
      newbieSignals,
      fatigueMultipliers,
      radiusM,
      weights,
    ] = await Promise.all([
      this.dataRepository.loadProfileScoringFields(candidateIds),
      this.dataRepository.loadPlans(candidateIds),
      this.dataRepository.loadActivity(candidateIds),
      this.dataRepository.loadReputationScores(candidateIds),
      this.dataRepository.loadNewbieSignals(candidateIds),
      this.feedImpressions.getFatigueMultipliers(viewerId, candidateIds),
      this.resolveRadiusM(viewerId),
      this.weightsProvider.getActiveWeights(),
    ]);
    const now = this.clock.now();
    const result = new Map<string, ScoredCandidate>();

    for (const candidateId of candidateIds) {
      const facts = gateFactsByCandidate.get(candidateId);
      if (!facts) continue;

      const candidateIntents = candidateIntentsByUser.get(candidateId) ?? [];
      const sIntent = intentScore(viewerIntents, candidateIntents);

      const gateContext: GateContext = {
        viewerId,
        candidateId,
        isBlockedEitherDirection: facts.isBlockedEitherDirection,
        hasActiveSuppression: facts.hasActiveSuppression,
        isConnectedOrPendingRequest: facts.isConnectedOrPendingRequest,
        profileVisibility: facts.profileVisibility,
        viewerIsMatch: false,
        accountStatus: facts.accountStatus,
        profileCompletion: facts.profileCompletion,
        intentScore: sIntent,
        passesInboundFilter: true, // full inbound-filter re-check (G9) needs the viewer's own profile facts; deferred to the connection-request send path (§11.4's own "re-verified at request-send time"), same as G8.
        availabilityState: facts.availabilityState,
        ...(facts.cooldownActiveUntil ? { cooldownActiveUntil: facts.cooldownActiveUntil } : {}),
        ...(facts.lastSessionAt ? { lastSessionAt: facts.lastSessionAt } : {}),
      };
      if (applyGates(gateContext, this.clock).excluded) continue;

      if (
        surface === "available_now" &&
        viewerAvailability.get(viewerId)?.state === "available_now"
      ) {
        // PRD §11.5.1's "Critical rule."
        if (candidateAvailability.get(candidateId)?.state !== "available_now") continue;
      }

      const staticRow =
        precomputed.get(candidateId) ??
        (await this.staticComponents.compute(viewerId, candidateId)).components;

      const candidateLive = candidateAvailability.get(candidateId);
      const sAvail = candidateLive ? this.scoreAvailability(candidateLive, now) : 0;
      const distanceM = distanceByCandidateId.get(candidateId) ?? null;
      const { score: sLoc, tier: locationTier } = this.scoreLocation(
        viewerLoc,
        candidateLocations.get(candidateId),
        distanceM,
        radiusM,
      );

      const candidateProfile = profileFields.get(candidateId);
      const activityFacts = activity.get(candidateId) ?? {
        activeDaysLast14: 0,
        availabilitySessionsLast14: 0,
      };
      const sActivity = activityScore(activityFacts);
      const sRep = reputationSubScore(reputation.get(candidateId) ?? 50);

      const components: SubScores = {
        avail: sAvail,
        intent: sIntent,
        loc: sLoc,
        activity: sActivity,
        rep: sRep,
        ...staticRow,
      };

      const newbie = newbieSignals.get(candidateId);
      const inactiveDays = facts.lastSessionAt
        ? (now.getTime() - facts.lastSessionAt.getTime()) / 86_400_000
        : STALE_INACTIVE_FLOOR_DAYS;
      const isNewbie = newbie
        ? daysSince(newbie.createdAt, now) < NEWBIE_MAX_DAYS &&
          newbie.connectionCount < NEWBIE_MAX_CONNECTIONS
        : false;

      const multiplier = computeMultiplier({
        verificationLevel: candidateProfile?.verificationLevel ?? "L0",
        plan: plans.get(candidateId) ?? "free",
        candidateInactiveDays: inactiveDays,
        // Convene Hours (m_convene) needs a feature this phase doesn't
        // build yet — 1.0/false is its documented neutral default, not a
        // silent omission.
        bothInConveneHour: false,
        fatigueMultiplier: fatigueMultipliers.get(candidateId) ?? 1.0,
        candidateIsNewbie: isNewbie,
      });

      const { score, weightedSum } = computeScore(components, multiplier, weights);
      result.set(candidateId, {
        candidateId,
        score,
        weightedSum,
        multiplier,
        components,
        locationTier,
        distanceM,
      });
    }

    return result;
  }

  private async toDiversityCandidates(
    viewerId: string,
    sorted: readonly ScoredCandidate[],
  ): Promise<DiversityCandidate[]> {
    if (sorted.length === 0) return [];
    const candidateIds = sorted.map((m) => m.candidateId);
    const [profileFields, newbieSignals, everShown, candidateIntents] = await Promise.all([
      this.dataRepository.loadProfileScoringFields(candidateIds),
      this.dataRepository.loadNewbieSignals(candidateIds),
      this.dataRepository.loadEverShown(viewerId, candidateIds),
      this.dataRepository.loadIntentRefsForUsers(candidateIds, new Map()),
    ]);
    const now = this.clock.now();

    return sorted.map((match) => {
      const profile = profileFields.get(match.candidateId);
      const newbie = newbieSignals.get(match.candidateId);
      const isNewUser = newbie
        ? daysSince(newbie.createdAt, now) < NEWBIE_MAX_DAYS &&
          newbie.connectionCount < NEWBIE_MAX_CONNECTIONS
        : false;
      const primaryIntent =
        candidateIntents.get(match.candidateId)?.find((intent) => intent.isPrimary)?.type ?? null;

      return {
        id: match.candidateId,
        score: match.score,
        company: profile?.companyName ?? null,
        industry: profile?.industryId != null ? String(profile.industryId) : null,
        primaryIntent,
        isNewUser,
        everShownToViewer: everShown.has(match.candidateId),
      };
    });
  }

  private async resolveRadiusM(viewerId: string): Promise<number> {
    const [profileRow] = await this.postgres.db
      .select({ searchRadiusKm: profiles.searchRadiusKm })
      .from(profiles)
      .where(eq(profiles.userId, viewerId))
      .limit(1);
    return (profileRow?.searchRadiusKm ?? 25) * 1000;
  }

  private async recallCandidates(
    viewerId: string,
    tab: DiscoverTab,
  ): Promise<{
    candidateIds: string[];
    stage: number;
    distanceByCandidateId: Map<string, number | null>;
  }> {
    if (tab === "global") {
      // §14.8 "Global" tab: skip both the precomputed fast path and the
      // staged radius ladder — worldwide recall, unscoped by the viewer's
      // own search-radius preference.
      const ctx = await this.candidateRepository.resolveViewerContext(viewerId);
      const rows = ctx ? await this.candidateRepository.stage5(ctx) : [];
      return {
        candidateIds: rows.map((row) => row.userId),
        stage: 5,
        distanceByCandidateId: new Map(),
      };
    }

    const precomputed = await this.dataRepository.loadPrecomputedCandidates(
      viewerId,
      FEED_TARGET_CANDIDATES,
    );
    if (precomputed.length > 0) {
      // No per-candidate distance in the precomputed fast path — location
      // scoring falls back to city/state/country comparison (scoreLocation).
      return {
        candidateIds: precomputed.map((row) => row.candidateId),
        stage: 0,
        distanceByCandidateId: new Map(),
      };
    }

    const radiusM = await this.resolveRadiusM(viewerId);
    const expansion = await this.expansionService.expand(viewerId, radiusM / 1000);
    const distanceByCandidateId = new Map(
      expansion.candidates.map((row) => [row.userId, row.distanceM]),
    );
    return {
      candidateIds: expansion.candidates.map((row) => row.userId),
      stage: expansion.stage,
      distanceByCandidateId,
    };
  }

  // PRD §10.5.4/§11.5.4's location tier: 0/1 (within/near the viewer's
  // radius, only knowable from the live-recall path's own distance
  // figure) falls back to 2/3/4 (same city/state/country) when only the
  // precomputed fast path's coarser signal is available, and 5 otherwise
  // — the same tier ladder candidate.repository.ts's stage system already
  // walks, reused here as the scoring input §10.5.4's locationScore wants.
  private scoreLocation(
    viewerLoc: Awaited<ReturnType<MatchingDataRepository["loadLocationContext"]>> extends Map<
      string,
      infer V
    >
      ? V | undefined
      : never,
    candidateLoc: Awaited<ReturnType<MatchingDataRepository["loadLocationContext"]>> extends Map<
      string,
      infer V
    >
      ? V | undefined
      : never,
    distanceM: number | null,
    radiusM: number,
  ): { score: number; tier: number } {
    if (!viewerLoc || !candidateLoc) return { score: 0.5, tier: 6 };

    let tier: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    let tier1DistanceRatio: number | undefined;
    if (distanceM !== null) {
      tier = distanceM <= radiusM ? 0 : 1;
      if (tier === 1) tier1DistanceRatio = Math.min(1, distanceM / radiusM);
    } else if (viewerLoc.cityId !== null && candidateLoc.cityId === viewerLoc.cityId) {
      tier = 2;
    } else if (viewerLoc.stateId !== null && candidateLoc.stateId === viewerLoc.stateId) {
      tier = 3;
    } else if (
      viewerLoc.countryCode !== null &&
      candidateLoc.countryCode === viewerLoc.countryCode
    ) {
      tier = 4;
    } else {
      tier = 5;
    }

    const score = locationScore({
      tier,
      ...(tier1DistanceRatio !== undefined ? { tier1DistanceRatio } : {}),
      isHiddenLocation: candidateLoc.isHiddenLocation,
      bothRemotePreference:
        viewerLoc.remotePreference === "remote" && candidateLoc.remotePreference === "remote",
      candidateOpenToRelocateToViewerCity: candidateLoc.openToRelocate,
      viewerRemotePreference: viewerLoc.remotePreference,
    });
    return { score, tier };
  }

  private async loadPrecomputedByCandidate(
    viewerId: string,
    candidateIds: readonly string[],
  ): Promise<Map<string, PrecomputedComponents>> {
    const rows = await this.dataRepository.loadPrecomputedCandidates(
      viewerId,
      FEED_TARGET_CANDIDATES,
    );
    const byId = new Map(rows.map((row) => [row.candidateId, row.components]));
    // Only return entries actually within this request's candidate set —
    // the caller falls back to a live compute for anything missing
    // (cold-start pairs the hourly worker hasn't reached yet).
    const result = new Map<string, PrecomputedComponents>();
    for (const id of candidateIds) {
      const row = byId.get(id);
      if (row) result.set(id, row);
    }
    return result;
  }

  private async loadIntents(userId: string): Promise<IntentRef[]> {
    const availability = await this.dataRepository.loadAvailabilityLive([userId]);
    return this.dataRepository.loadIntentRefs(userId, availability.get(userId)?.intentIds ?? null);
  }

  private scoreAvailability(
    live: NonNullable<
      Awaited<ReturnType<MatchingDataRepository["loadAvailabilityLive"]>> extends Map<
        string,
        infer V
      >
        ? V
        : never
    >,
    now: Date,
  ): number {
    if (live.state === "available_now") {
      return availabilityScore(
        { state: "available_now", expiresAt: live.expiresAt ?? now },
        this.clock,
      );
    }
    if (live.state === "offline") {
      return availabilityScore({ state: "offline", lastSeenAt: live.updatedAt }, this.clock);
    }
    return availabilityScore({ state: live.state }, this.clock);
  }
}

function daysSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / 86_400_000;
}
