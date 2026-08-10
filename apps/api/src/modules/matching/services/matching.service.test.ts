import { DEFAULT_WEIGHTS } from "@convene/matching";
import { describe, expect, it, vi } from "vitest";
import { MatchingService } from "./matching.service";
import type { CacheService } from "../../../common/cache/cache.service";
import type { PostgresService } from "../../../infra/postgres/postgres.service";
import type { ExpansionService } from "./expansion.service";
import type { FeedImpressionsService } from "./feed-impressions.service";
import type { MatchingWeightsProvider } from "./matching-weights-provider";
import type { CandidateRepository } from "../repositories/candidate.repository";
import type { MatchingDataRepository } from "../repositories/matching-data.repository";
import type { StaticComponentsService } from "./static-components.service";

const now = new Date("2026-08-08T12:00:00Z");
const clock = { now: () => now };

function fakeCache(): CacheService {
  return {
    getOrSet: vi.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) =>
      factory(),
    ),
    invalidate: vi.fn(async () => undefined),
  } as unknown as CacheService;
}

function fakePostgres(searchRadiusKm = 25): PostgresService {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ searchRadiusKm }],
          }),
        }),
      }),
    },
  } as unknown as PostgresService;
}

function fakeFeedImpressions(): FeedImpressionsService {
  return {
    getFatigueMultipliers: vi.fn(
      async (_viewerId: string, candidateIds: string[]) =>
        new Map(candidateIds.map((id) => [id, 1.0])),
    ),
    recordImpressions: vi.fn(async () => undefined),
  } as unknown as FeedImpressionsService;
}

const availableNowState = {
  state: "available_now" as const,
  expiresAt: new Date(now.getTime() + 20 * 60_000),
  intentIds: null,
  updatedAt: now,
};
const offlineState = {
  state: "offline" as const,
  expiresAt: null,
  intentIds: null,
  updatedAt: now,
};

function baseGateFacts(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isBlockedEitherDirection: false,
    hasActiveSuppression: false,
    isConnectedOrPendingRequest: false,
    profileVisibility: "public" as const,
    accountStatus: "active" as const,
    profileCompletion: 80,
    availabilityState: "available_now" as const,
    lastSessionAt: now,
    ...overrides,
  };
}

function fakeDataRepository(
  overrides: Partial<Record<keyof MatchingDataRepository, unknown>> = {},
): MatchingDataRepository {
  const base = {
    loadPrecomputedCandidates: vi.fn(async () => []),
    loadGateFacts: vi.fn(
      async (_viewerId: string, candidateIds: string[]) =>
        new Map(candidateIds.map((id) => [id, baseGateFacts()])),
    ),
    loadAvailabilityLive: vi.fn(
      async (userIds: string[]) => new Map(userIds.map((id) => [id, availableNowState])),
    ),
    loadIntentRefs: vi.fn(async () => [{ type: "coffee_chat", isPrimary: true }]),
    loadIntentRefsForUsers: vi.fn(
      async (userIds: string[]) =>
        new Map(userIds.map((id) => [id, [{ type: "coffee_chat", isPrimary: true }]])),
    ),
    loadProfileScoringFields: vi.fn(
      async (userIds: string[]) =>
        new Map(
          userIds.map((id) => [
            id,
            {
              yearsExperience: 3,
              industryId: 1,
              verificationLevel: "L2" as const,
              createdAt: new Date("2020-01-01"),
              companyName: null,
            },
          ]),
        ),
    ),
    loadPlans: vi.fn(
      async (userIds: string[]) => new Map(userIds.map((id) => [id, "free" as const])),
    ),
    loadActivity: vi.fn(
      async (userIds: string[]) =>
        new Map(userIds.map((id) => [id, { activeDaysLast14: 5, availabilitySessionsLast14: 2 }])),
    ),
    loadReputationScores: vi.fn(
      async (userIds: string[]) => new Map(userIds.map((id) => [id, 60])),
    ),
    loadNewbieSignals: vi.fn(
      async (userIds: string[]) =>
        new Map(
          userIds.map((id) => [id, { createdAt: new Date("2020-01-01"), connectionCount: 10 }]),
        ),
    ),
    loadLocationContext: vi.fn(
      async (userIds: string[]) =>
        new Map(
          userIds.map((id) => [
            id,
            {
              cityId: 1,
              stateId: 1,
              countryCode: "IN",
              isHiddenLocation: false,
              remotePreference: "any" as const,
              openToRelocate: false,
            },
          ]),
        ),
    ),
    loadEverShown: vi.fn(async () => new Set<string>()),
  };
  return { ...base, ...overrides } as unknown as MatchingDataRepository;
}

function fakeExpansion(candidateIds: string[]): ExpansionService {
  return {
    expand: vi.fn(async () => ({
      candidates: candidateIds.map((userId) => ({ userId, distanceM: 1000 })),
      stage: 0,
      labels: ["Nearby"],
      pinned: false,
    })),
  } as unknown as ExpansionService;
}

function fakeStaticComponents(): StaticComponentsService {
  return {
    compute: vi.fn(async () => ({
      components: { skill: 0.5, industry: 0.5, exp: 0.5, interest: 0.5, mutual: 0.5, lang: 0.5 },
      staticScore: 0.5,
    })),
  } as unknown as StaticComponentsService;
}

function fakeCandidateRepository(): CandidateRepository {
  return {
    resolveViewerContext: vi.fn(async (viewerId: string) => ({
      viewerId,
      latitude: 12.9,
      longitude: 77.6,
      cityId: 1,
      stateId: 1,
      countryCode: "IN",
      timezone: "Asia/Kolkata",
    })),
    distanceBetween: vi.fn(async () => 1000),
  } as unknown as CandidateRepository;
}

function fakeWeightsProvider(): MatchingWeightsProvider {
  return {
    getActiveWeights: vi.fn(async () => DEFAULT_WEIGHTS),
  } as unknown as MatchingWeightsProvider;
}

function buildService(
  dataRepository: MatchingDataRepository,
  expansion: ExpansionService,
  overrides: {
    cache?: CacheService;
    feedImpressions?: FeedImpressionsService;
    postgres?: PostgresService;
    candidateRepository?: CandidateRepository;
    weightsProvider?: MatchingWeightsProvider;
  } = {},
): MatchingService {
  return new MatchingService(
    overrides.postgres ?? fakePostgres(),
    expansion,
    overrides.candidateRepository ?? fakeCandidateRepository(),
    dataRepository,
    fakeStaticComponents(),
    overrides.feedImpressions ?? fakeFeedImpressions(),
    overrides.weightsProvider ?? fakeWeightsProvider(),
    overrides.cache ?? fakeCache(),
    clock,
  );
}

describe("MatchingService", () => {
  it("returns a scored, sorted feed for candidates recalled live (no precompute yet)", async () => {
    const dataRepository = fakeDataRepository();
    const service = buildService(dataRepository, fakeExpansion(["c1", "c2"]));

    const result = await service.getFeed("viewer-1", "discover");

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]!.score).toBeGreaterThanOrEqual(result.matches[1]!.score);
    for (const match of result.matches) {
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(100);
    }
    expect(result.nextCursor).toBeNull(); // fewer than PAGE_SIZE (20) results
  });

  it("excludes a blocked candidate via G2, even though they'd otherwise score", async () => {
    const dataRepository = fakeDataRepository({
      loadGateFacts: vi.fn(async (_viewerId: string, candidateIds: string[]) => {
        const map = new Map(candidateIds.map((id) => [id, baseGateFacts()]));
        map.set("c1", baseGateFacts({ isBlockedEitherDirection: true }));
        return map;
      }),
    });
    const service = buildService(dataRepository, fakeExpansion(["c1", "c2"]));

    const result = await service.getFeed("viewer-1", "discover");

    expect(result.matches.map((m) => m.candidateId)).toEqual(["c2"]);
  });

  it("available_now surface hard-filters to available_now candidates when the viewer is also available_now", async () => {
    const dataRepository = fakeDataRepository({
      loadAvailabilityLive: vi.fn(
        async (userIds: string[]) =>
          new Map(userIds.map((id) => [id, id === "c2" ? offlineState : availableNowState])),
      ),
      loadGateFacts: vi.fn(async (_viewerId: string, candidateIds: string[]) => {
        const map = new Map(candidateIds.map((id) => [id, baseGateFacts()]));
        map.set("c2", baseGateFacts({ availabilityState: "offline" }));
        return map;
      }),
    });
    const service = buildService(dataRepository, fakeExpansion(["c1", "c2"]));

    const result = await service.getFeed("viewer-1", "available_now");

    expect(result.matches.map((m) => m.candidateId)).toEqual(["c1"]);
  });

  // PRD §11.5.1's own "Critical rule": "Score-only ranking would let a
  // very high-scoring offline user outrank a decent available one,
  // defeating the product's purpose." c2 is deliberately given every
  // advantage that raises its score (verified L4, Pro plan, 100
  // reputation vs c1's L2/free/60) while being busy, not available_now —
  // proving the hard filter, not the availability sub-score, is what
  // excludes it.
  it("excludes a busy candidate from Available Now even when it would score strictly higher than the available one", async () => {
    const busyState = { state: "busy" as const, expiresAt: null, intentIds: null, updatedAt: now };
    const dataRepository = fakeDataRepository({
      loadAvailabilityLive: vi.fn(
        async (userIds: string[]) =>
          new Map(userIds.map((id) => [id, id === "c2" ? busyState : availableNowState])),
      ),
      loadGateFacts: vi.fn(async (_viewerId: string, candidateIds: string[]) => {
        const map = new Map(candidateIds.map((id) => [id, baseGateFacts()]));
        map.set("c2", baseGateFacts({ availabilityState: "busy" }));
        return map;
      }),
      loadProfileScoringFields: vi.fn(
        async (userIds: string[]) =>
          new Map(
            userIds.map((id) => [
              id,
              {
                yearsExperience: 3,
                industryId: 1,
                verificationLevel: id === "c2" ? ("L4" as const) : ("L2" as const),
                createdAt: new Date("2020-01-01"),
                companyName: null,
              },
            ]),
          ),
      ),
      loadPlans: vi.fn(
        async (userIds: string[]) =>
          new Map(userIds.map((id) => [id, id === "c2" ? ("pro" as const) : ("free" as const)])),
      ),
      loadReputationScores: vi.fn(
        async (userIds: string[]) => new Map(userIds.map((id) => [id, id === "c2" ? 100 : 60])),
      ),
    });
    const service = buildService(dataRepository, fakeExpansion(["c1", "c2"]));

    // First confirm the premise: on the unrestricted "discover" surface,
    // c2 (busy, but boosted) actually does outscore c1 (available, unboosted).
    const discoverResult = await service.getFeed("viewer-1", "discover");
    const c1Score = discoverResult.matches.find((m) => m.candidateId === "c1")!.score;
    const c2Score = discoverResult.matches.find((m) => m.candidateId === "c2")!.score;
    expect(c2Score).toBeGreaterThan(c1Score);

    // Yet Available Now still excludes it entirely.
    const availableNowResult = await service.getFeed("viewer-1", "available_now");
    expect(availableNowResult.matches.map((m) => m.candidateId)).toEqual(["c1"]);
  });

  it("does not apply the available_now hard filter on the discover surface", async () => {
    const dataRepository = fakeDataRepository({
      loadAvailabilityLive: vi.fn(
        async (userIds: string[]) =>
          new Map(userIds.map((id) => [id, id === "c2" ? offlineState : availableNowState])),
      ),
      loadGateFacts: vi.fn(async (_viewerId: string, candidateIds: string[]) => {
        const map = new Map(candidateIds.map((id) => [id, baseGateFacts()]));
        map.set("c2", baseGateFacts({ availabilityState: "offline" }));
        return map;
      }),
    });
    const service = buildService(dataRepository, fakeExpansion(["c1", "c2"]));

    const result = await service.getFeed("viewer-1", "discover");

    expect(result.matches.map((m) => m.candidateId).sort()).toEqual(["c1", "c2"]);
  });

  it("prefers the precomputed fast path over live expansion recall when available", async () => {
    const dataRepository = fakeDataRepository({
      loadPrecomputedCandidates: vi.fn(async () => [
        {
          candidateId: "p1",
          staticScore: 0.6,
          components: {
            skill: 0.6,
            industry: 0.6,
            exp: 0.6,
            interest: 0.6,
            mutual: 0.6,
            lang: 0.6,
          },
        },
      ]),
    });
    const expansion = fakeExpansion(["should-not-be-used"]);
    const service = buildService(dataRepository, expansion);

    const result = await service.getFeed("viewer-1", "discover");

    expect(result.matches.map((m) => m.candidateId)).toEqual(["p1"]);
    expect(expansion.expand).not.toHaveBeenCalled();
  });

  it("records a feed impression for every candidate actually shown on the page", async () => {
    const feedImpressions = fakeFeedImpressions();
    const service = buildService(fakeDataRepository(), fakeExpansion(["c1", "c2"]), {
      feedImpressions,
    });

    await service.getFeed("viewer-1", "discover");

    expect(feedImpressions.recordImpressions).toHaveBeenCalledWith(
      "viewer-1",
      expect.arrayContaining([
        expect.objectContaining({ candidateId: "c1" }),
        expect.objectContaining({ candidateId: "c2" }),
      ]),
    );
  });

  it("scoreCandidate returns the same score a full feed computation would produce for that candidate", async () => {
    const dataRepository = fakeDataRepository();
    const service = buildService(dataRepository, fakeExpansion(["c1", "c2"]));

    const feed = await service.getFeed("viewer-1", "discover");
    const explained = await service.scoreCandidate("viewer-1", "c1");

    const fromFeed = feed.matches.find((m) => m.candidateId === "c1")!;
    expect(explained).toEqual(fromFeed);
  });

  it("invalidateFeedCache clears both surfaces' un-paginated cache entry for the given user", async () => {
    const cache = fakeCache();
    const service = buildService(fakeDataRepository(), fakeExpansion([]), { cache });

    await service.invalidateFeedCache("user-1");

    expect(cache.invalidate).toHaveBeenCalledWith("feed:user-1:discover:nearby:start");
    expect(cache.invalidate).toHaveBeenCalledWith("feed:user-1:discover:global:start");
    expect(cache.invalidate).toHaveBeenCalledWith("feed:user-1:available_now:nearby:start");
    expect(cache.invalidate).toHaveBeenCalledWith("feed:user-1:available_now:global:start");
  });
});
