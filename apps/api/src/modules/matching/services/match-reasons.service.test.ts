import { DEFAULT_WEIGHTS } from "@convene/matching";
import { describe, expect, it, vi } from "vitest";
import { MatchReasonsService } from "./match-reasons.service";
import type { MatchingDataRepository } from "../repositories/matching-data.repository";
import type { MatchingWeightsProvider } from "./matching-weights-provider";
import type { ScoredCandidate } from "./matching.service";

function fakeMatch(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    candidateId: "c1",
    score: 79,
    weightedSum: 0.79,
    multiplier: 1.0,
    components: { intent: 1, avail: 0.65, loc: 0.4, skill: 0.5 },
    locationTier: 1,
    distanceM: 10_000,
    ...overrides,
  };
}

function fakeDataRepository(
  overrides: Partial<Record<keyof MatchingDataRepository, unknown>> = {},
): MatchingDataRepository {
  const base = {
    loadIntentRefs: vi.fn(async () => [{ type: "need_mentor", isPrimary: true }]),
    loadIntentRefsForUsers: vi.fn(
      async (candidateIds: string[]) =>
        new Map(candidateIds.map((id) => [id, [{ type: "need_mentee", isPrimary: true }]])),
    ),
    loadDisplayFacts: vi.fn(
      async (candidateIds: string[]) =>
        new Map(
          candidateIds.map((id) => [
            id,
            { firstName: "Meera", cityName: "Hyderabad", industryName: "Tech", responseRate: 0.8 },
          ]),
        ),
    ),
    loadSkillBundles: vi.fn(
      async (userIds: string[]) =>
        new Map(
          userIds.map((id) => [
            id,
            { names: ["Python", "SQL"], functionalAreas: [], meanEmbedding: null },
          ]),
        ),
    ),
    loadMutualConnectionCounts: vi.fn(
      async (_viewerId: string, candidateIds: string[]) =>
        new Map(candidateIds.map((id) => [id, 3])),
    ),
    loadAvailabilityLive: vi.fn(
      async (userIds: string[]) =>
        new Map(
          userIds.map((id) => [
            id,
            {
              state: "available_now" as const,
              expiresAt: new Date(Date.now() + 22 * 60_000),
              intentIds: null,
              updatedAt: new Date(),
            },
          ]),
        ),
    ),
    loadProfileScoringFields: vi.fn(
      async (userIds: string[]) =>
        new Map(
          userIds.map((id) => [
            id,
            {
              yearsExperience: 5,
              industryId: 1,
              verificationLevel: "L2" as const,
              createdAt: new Date(),
              companyName: null,
            },
          ]),
        ),
    ),
  };
  return { ...base, ...overrides } as unknown as MatchingDataRepository;
}

function fakeWeightsProvider(): MatchingWeightsProvider {
  return {
    getActiveWeights: vi.fn(async () => DEFAULT_WEIGHTS),
  } as unknown as MatchingWeightsProvider;
}

describe("MatchReasonsService", () => {
  it("returns an empty map for an empty page without querying anything", async () => {
    const dataRepository = fakeDataRepository();
    const service = new MatchReasonsService(dataRepository, fakeWeightsProvider());

    const result = await service.generateReasonsForPage("viewer-1", []);

    expect(result.size).toBe(0);
    expect(dataRepository.loadIntentRefs).not.toHaveBeenCalled();
  });

  it("generates up to 3 reasons per candidate", async () => {
    const service = new MatchReasonsService(fakeDataRepository(), fakeWeightsProvider());

    const result = await service.generateReasonsForPage("viewer-1", [fakeMatch()]);

    const reasons = result.get("c1");
    expect(reasons).toBeDefined();
    expect(reasons!.length).toBeGreaterThan(0);
    expect(reasons!.length).toBeLessThanOrEqual(3);
  });

  it("mentions the intent complementarity when both sides have a strong mutual intent match", async () => {
    const service = new MatchReasonsService(fakeDataRepository(), fakeWeightsProvider());

    const result = await service.generateReasonsForPage("viewer-1", [fakeMatch()]);

    const reasons = result.get("c1")!;
    expect(reasons.some((r) => r.includes("mentor"))).toBe(true);
  });

  it("produces one entry per candidate on a multi-candidate page", async () => {
    const service = new MatchReasonsService(fakeDataRepository(), fakeWeightsProvider());

    const result = await service.generateReasonsForPage("viewer-1", [
      fakeMatch({ candidateId: "c1" }),
      fakeMatch({ candidateId: "c2", score: 65 }),
    ]);

    expect(result.size).toBe(2);
    expect(result.has("c1")).toBe(true);
    expect(result.has("c2")).toBe(true);
  });
});
