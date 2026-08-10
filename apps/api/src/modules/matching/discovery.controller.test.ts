import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { DiscoveryController } from "./discovery.controller";
import type { MatchingDataRepository } from "./repositories/matching-data.repository";
import type { MatchReasonsService } from "./services/match-reasons.service";
import type { FeedResult, MatchingService } from "./services/matching.service";

const authContext: AuthContext = {
  id: "viewer-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function fakeMatchingService(result: FeedResult): MatchingService {
  return { getFeed: vi.fn(async () => result) } as unknown as MatchingService;
}

function fakeReasons(): MatchReasonsService {
  return { generateReasonsForPage: vi.fn(async () => new Map()) } as unknown as MatchReasonsService;
}

function fakeDataRepository(profileCompletion: number | null): MatchingDataRepository {
  return {
    loadProfileCompletion: vi.fn(async () => profileCompletion),
  } as unknown as MatchingDataRepository;
}

const populatedResult: FeedResult = {
  matches: [
    {
      candidateId: "c1",
      score: 79,
      weightedSum: 0.79,
      multiplier: 1,
      components: {},
      locationTier: 1,
      distanceM: 5000,
    },
  ],
  expansionStage: 1,
  nextCursor: "abc",
  candidatesRecalled: 5,
  candidatesScored: 5,
};

describe("DiscoveryController", () => {
  describe("GET /discover", () => {
    it("returns cards with reasons, meta, and no empty_state when matches exist", async () => {
      const reasons = fakeReasons();
      (reasons.generateReasonsForPage as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Map([["c1", ["Shared intent"]]]),
      );
      const controller = new DiscoveryController(
        fakeMatchingService(populatedResult),
        reasons,
        fakeDataRepository(80),
      );

      const result = await controller.discover({ authContext });

      expect(result.empty_state).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        candidate_id: "c1",
        score: 79,
        reasons: ["Shared intent"],
        expansion_stage: 1,
        location_tier: 1,
      });
      expect(result.meta).toEqual({ next_cursor: "abc", has_more: true, expansion_stage: 1 });
    });

    it("defaults tab to nearby and passes global through when requested", async () => {
      const matchingService = fakeMatchingService(populatedResult);
      const controller = new DiscoveryController(
        matchingService,
        fakeReasons(),
        fakeDataRepository(80),
      );

      await controller.discover({ authContext });
      expect(matchingService.getFeed).toHaveBeenCalledWith(
        "viewer-1",
        "discover",
        "nearby",
        undefined,
      );

      await controller.discover({ authContext }, "global");
      expect(matchingService.getFeed).toHaveBeenCalledWith(
        "viewer-1",
        "discover",
        "global",
        undefined,
      );
    });

    it("rejects an unrecognised tab value by falling back to nearby rather than erroring", async () => {
      const matchingService = fakeMatchingService(populatedResult);
      const controller = new DiscoveryController(
        matchingService,
        fakeReasons(),
        fakeDataRepository(80),
      );

      await controller.discover({ authContext }, "not-a-real-tab");
      expect(matchingService.getFeed).toHaveBeenCalledWith(
        "viewer-1",
        "discover",
        "nearby",
        undefined,
      );
    });

    it("rejects when no auth context is present", async () => {
      const controller = new DiscoveryController(
        fakeMatchingService(populatedResult),
        fakeReasons(),
        fakeDataRepository(80),
      );
      await expect(controller.discover({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    // Each of P13.1's four named empty-state reasons must be reachable.
    it("empty_state: profile_incomplete when the viewer's own profile is below the completion floor", async () => {
      const controller = new DiscoveryController(
        fakeMatchingService(populatedResult),
        fakeReasons(),
        fakeDataRepository(20),
      );
      const result = await controller.discover({ authContext });
      expect(result.empty_state).toBe("profile_incomplete");
      expect(result.data).toEqual([]);
    });

    it("empty_state: profile_incomplete when the viewer has no profile row at all", async () => {
      const controller = new DiscoveryController(
        fakeMatchingService(populatedResult),
        fakeReasons(),
        fakeDataRepository(null),
      );
      const result = await controller.discover({ authContext });
      expect(result.empty_state).toBe("profile_incomplete");
    });

    it("empty_state: no_supply when Tier A recall found nobody at all", async () => {
      const empty: FeedResult = {
        matches: [],
        expansionStage: 5,
        nextCursor: null,
        candidatesRecalled: 0,
        candidatesScored: 0,
      };
      const controller = new DiscoveryController(
        fakeMatchingService(empty),
        fakeReasons(),
        fakeDataRepository(80),
      );
      const result = await controller.discover({ authContext });
      expect(result.empty_state).toBe("no_supply");
    });

    it("empty_state: all_filtered when candidates were recalled but every one was gated out", async () => {
      const gatedOut: FeedResult = {
        matches: [],
        expansionStage: 2,
        nextCursor: null,
        candidatesRecalled: 8,
        candidatesScored: 0,
      };
      const controller = new DiscoveryController(
        fakeMatchingService(gatedOut),
        fakeReasons(),
        fakeDataRepository(80),
      );
      const result = await controller.discover({ authContext });
      expect(result.empty_state).toBe("all_filtered");
    });

    it("empty_state: all_seen when this is a later page (cursor supplied) and nothing new is left", async () => {
      const exhausted: FeedResult = {
        matches: [],
        expansionStage: 2,
        nextCursor: null,
        candidatesRecalled: 8,
        candidatesScored: 8,
      };
      const controller = new DiscoveryController(
        fakeMatchingService(exhausted),
        fakeReasons(),
        fakeDataRepository(80),
      );
      const result = await controller.discover({ authContext }, undefined, "some-cursor-token");
      expect(result.empty_state).toBe("all_seen");
    });
  });

  describe("GET /discover/available-now", () => {
    it("calls MatchingService with the available_now surface", async () => {
      const matchingService = fakeMatchingService(populatedResult);
      const controller = new DiscoveryController(
        matchingService,
        fakeReasons(),
        fakeDataRepository(80),
      );

      await controller.availableNow({ authContext });

      expect(matchingService.getFeed).toHaveBeenCalledWith(
        "viewer-1",
        "available_now",
        "nearby",
        undefined,
      );
    });
  });
});
