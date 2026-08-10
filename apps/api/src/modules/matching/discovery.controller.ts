import { Controller, Get, Query, Req } from "@nestjs/common";
import type { AuthContext } from "../../common/auth/auth-context";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { MatchingDataRepository } from "./repositories/matching-data.repository";
import { MatchReasonsService } from "./services/match-reasons.service";
import {
  MatchingService,
  type DiscoverTab,
  type FeedResult,
  type ScoredCandidate,
} from "./services/matching.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §11.9's own four named empty-state reasons — the P13.1 prompt's
// exact list (no_supply, all_filtered, all_seen, profile_incomplete) so
// the client can render §14.8's tier-specific copy instead of one
// generic message.
type EmptyStateReason = "no_supply" | "all_filtered" | "all_seen" | "profile_incomplete";

interface MatchCard {
  candidate_id: string;
  score: number;
  reasons: string[];
  expansion_stage: number;
  location_tier: number;
}

interface DiscoveryResponse {
  data: MatchCard[];
  meta: { next_cursor: string | null; has_more: boolean; expansion_stage: number };
  empty_state: EmptyStateReason | null;
}

const PROFILE_COMPLETION_FLOOR = 40; // §11.4 G7 / §11.9.

// PRD endpoints 28/29 (§17.9, §14.8). Both share the same shape — a
// gated-viewer check, a MatchingService.getFeed() call, an empty-state
// reason derivation, and reason-chip generation for whatever page came
// back — so the actual work lives in one shared method.
@Controller()
export class DiscoveryController {
  constructor(
    private readonly matchingService: MatchingService,
    private readonly matchReasons: MatchReasonsService,
    private readonly dataRepository: MatchingDataRepository,
  ) {}

  // PRD §17.9 endpoint 28: "GET /discover | Ranked feed (tab, cursor)."
  @Get("discover")
  @Policy(selfScoped)
  async discover(
    @Req() request: RequestLike,
    @Query("tab") tab?: string,
    @Query("cursor") cursor?: string,
  ): Promise<DiscoveryResponse> {
    const { id: viewerId } = requireAuthContext(request);
    const resolvedTab: DiscoverTab = tab === "global" ? "global" : "nearby";
    return this.buildResponse(viewerId, "discover", resolvedTab, cursor);
  }

  // PRD §17.9 endpoint 29: "GET /discover/available-now | Live
  // availability feed." §11.5.1's "Critical rule" (the hard filter, not
  // just the availability sub-score) is enforced inside MatchingService
  // itself — this controller only wires the HTTP surface.
  @Get("discover/available-now")
  @Policy(selfScoped)
  async availableNow(
    @Req() request: RequestLike,
    @Query("cursor") cursor?: string,
  ): Promise<DiscoveryResponse> {
    const { id: viewerId } = requireAuthContext(request);
    return this.buildResponse(viewerId, "available_now", "nearby", cursor);
  }

  private async buildResponse(
    viewerId: string,
    surface: "discover" | "available_now",
    tab: DiscoverTab,
    cursor: string | undefined,
  ): Promise<DiscoveryResponse> {
    const profileCompletion = await this.dataRepository.loadProfileCompletion(viewerId);
    if (profileCompletion === null || profileCompletion < PROFILE_COMPLETION_FLOOR) {
      return {
        data: [],
        meta: { next_cursor: null, has_more: false, expansion_stage: 0 },
        empty_state: "profile_incomplete",
      };
    }

    const result = await this.matchingService.getFeed(viewerId, surface, tab, cursor);
    const reasonsByCandidate = await this.matchReasons.generateReasonsForPage(
      viewerId,
      result.matches,
    );

    return {
      data: result.matches.map((match) =>
        this.toCard(match, result.expansionStage, reasonsByCandidate),
      ),
      meta: {
        next_cursor: result.nextCursor,
        has_more: result.nextCursor !== null,
        expansion_stage: result.expansionStage,
      },
      empty_state: this.resolveEmptyState(result, cursor !== undefined),
    };
  }

  private toCard(
    match: ScoredCandidate,
    expansionStage: number,
    reasonsByCandidate: Map<string, string[]>,
  ): MatchCard {
    return {
      candidate_id: match.candidateId,
      score: match.score,
      reasons: reasonsByCandidate.get(match.candidateId) ?? [],
      expansion_stage: expansionStage,
      location_tier: match.locationTier,
    };
  }

  // PRD §14.8's empty states, translated to what MatchingService's
  // FeedResult actually distinguishes:
  //   no_supply      — Tier A recall itself found nobody at all.
  //   all_filtered   — candidates were recalled, but every one was
  //                    excluded by a hard gate or the available_now
  //                    hard filter.
  //   all_seen       — candidates existed and scored, but this is a
  //                    later page (a cursor was supplied) and nothing
  //                    new is left past that boundary.
  private resolveEmptyState(result: FeedResult, hasCursor: boolean): EmptyStateReason | null {
    if (result.matches.length > 0) return null;
    if (result.candidatesRecalled === 0) return "no_supply";
    if (result.candidatesScored === 0) return "all_filtered";
    return hasCursor ? "all_seen" : "all_filtered";
  }
}
