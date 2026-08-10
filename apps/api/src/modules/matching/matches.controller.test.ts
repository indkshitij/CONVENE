import { DEFAULT_WEIGHTS } from "@convene/matching";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { MatchesController } from "./matches.controller";
import type { MatchingService } from "./services/matching.service";
import type { PostgresService } from "../../infra/postgres/postgres.service";

const authContext: AuthContext = {
  id: "viewer-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function fakePostgres() {
  const inserted: unknown[] = [];
  const db = {
    insert: () => ({
      values: (values: unknown) => {
        inserted.push(values);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  };
  return { postgres: { db } as unknown as PostgresService, inserted };
}

describe("MatchesController", () => {
  describe("GET /matches/:id/explain", () => {
    it("returns a breakdown whose contributions sum to the candidate's own score", async () => {
      const matchingService = {
        scoreCandidate: vi.fn(async () => ({
          candidateId: "c1",
          score: 78,
          weightedSum: 0.78,
          multiplier: 1.0,
          components: { avail: 1, intent: 1, loc: 0.5, skill: 0.5 },
        })),
        getActiveWeights: vi.fn(async () => DEFAULT_WEIGHTS),
      } as unknown as MatchingService;
      const { postgres } = fakePostgres();
      const controller = new MatchesController(matchingService, postgres);

      const result = await controller.explain({ authContext }, "c1");

      expect(matchingService.scoreCandidate).toHaveBeenCalledWith("viewer-1", "c1");
      const sum = result.contributions.reduce((total, c) => total + c.contribution, 0);
      expect(sum).toBe(result.score);
      expect(result.contributions).toHaveLength(4);
    });

    it("throws MATCH_NOT_FOUND when the candidate isn't scoreable (gated out or doesn't exist)", async () => {
      const matchingService = {
        scoreCandidate: vi.fn(async () => null),
      } as unknown as MatchingService;
      const { postgres } = fakePostgres();
      const controller = new MatchesController(matchingService, postgres);

      await expect(controller.explain({ authContext }, "c1")).rejects.toMatchObject({
        code: "MATCH_NOT_FOUND",
        httpStatus: 404,
      });
    });

    it("rejects when no auth context is present", async () => {
      const controller = new MatchesController(
        {} as unknown as MatchingService,
        fakePostgres().postgres,
      );
      await expect(controller.explain({}, "c1")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("POST /matches/:id/skip", () => {
    it("writes a match_suppressions row for (viewer, candidate) with the given reason and invalidates the feed cache", async () => {
      const matchingService = {
        invalidateFeedCache: vi.fn(async () => undefined),
      } as unknown as MatchingService;
      const { postgres, inserted } = fakePostgres();
      const controller = new MatchesController(matchingService, postgres);

      await controller.skip({ authContext }, "c1", { reason: "Not the right fit" });

      expect(inserted).toEqual([
        { userId: "viewer-1", suppressedId: "c1", reason: "Not the right fit" },
      ]);
      expect(matchingService.invalidateFeedCache).toHaveBeenCalledWith("viewer-1");
    });

    it("defaults the reason to not_interested when none is given", async () => {
      const matchingService = {
        invalidateFeedCache: vi.fn(async () => undefined),
      } as unknown as MatchingService;
      const { postgres, inserted } = fakePostgres();
      const controller = new MatchesController(matchingService, postgres);

      await controller.skip({ authContext }, "c1", {});

      expect(inserted).toEqual([
        { userId: "viewer-1", suppressedId: "c1", reason: "not_interested" },
      ]);
    });
  });
});
