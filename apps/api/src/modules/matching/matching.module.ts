import { Module } from "@nestjs/common";
import { CacheService } from "../../common/cache/cache.service";
import { MatchPrecomputeWorker } from "../../workers/match-precompute.worker";
import { DiscoveryController } from "./discovery.controller";
import { MatchesController } from "./matches.controller";
import { CandidateRepository } from "./repositories/candidate.repository";
import { MatchingDataRepository } from "./repositories/matching-data.repository";
import { ExpansionService } from "./services/expansion.service";
import { FairnessAuditService } from "./services/fairness-audit.service";
import { FeedCacheInvalidationListener } from "./services/feed-cache-invalidation.listener";
import { FeedImpressionsService } from "./services/feed-impressions.service";
import { MatchPrecomputeService } from "./services/match-precompute.service";
import { MatchReasonsService } from "./services/match-reasons.service";
import { MatchingService } from "./services/matching.service";
import { MatchingWeightsProvider } from "./services/matching-weights-provider";
import { StaticComponentsService } from "./services/static-components.service";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P9.3: candidate generation + six-stage radius expansion (§10.5.5).
// P12.1: the two-tier matching engine — MatchPrecomputeService/Worker
// (offline hourly, §11.7 O1-O3) write match_candidates' static
// components; MatchingService (online, §11.7 R1-R8) joins that against
// live availability/intent/location, re-verifies every hard gate, applies
// multipliers, and caches the result for 90s.
// P12.2: ranking (diversity injection, exploration slots, cursor
// pagination), fatigue (FeedImpressionsService, feed_impressions), and
// MatchesController (endpoints 30/31 — explain/skip).
// P12.3: MatchingWeightsProvider (AD-8 remote config, Postgres-backed
// default) and FairnessAuditService (§11.11) — both exported so
// AdminModule's endpoints can call them without owning
// matching_weight_configs/feed_impressions themselves.
// P13.1: DiscoveryController (endpoints 28/29 — GET /discover,
// GET /discover/available-now) and MatchReasonsService (§11.10's
// generate_reasons(), scoped to the ≤20 candidates actually rendered).
// P14.1: MatchingDataRepository exported so ConnectionsModule can reuse
// its loadIntentRefs/loadReputationScores/loadProfileScoringFields
// batched loaders for the send-time intent-floor re-check (BR-CONN-02)
// and the senior/high-rep inbound-throttle default (BR-CONN-07), rather
// than reimplementing the same queries.
@Module({
  controllers: [MatchesController, DiscoveryController],
  providers: [
    CandidateRepository,
    MatchingDataRepository,
    ExpansionService,
    CacheService,
    StaticComponentsService,
    MatchPrecomputeService,
    MatchPrecomputeWorker,
    FeedImpressionsService,
    MatchingWeightsProvider,
    FairnessAuditService,
    MatchReasonsService,
    MatchingService,
    FeedCacheInvalidationListener,
  ],
  exports: [
    CandidateRepository,
    MatchingDataRepository,
    ExpansionService,
    MatchingService,
    StaticComponentsService,
    MatchPrecomputeService,
    FeedImpressionsService,
    MatchingWeightsProvider,
    FairnessAuditService,
  ],
})
export class MatchingModule {}
