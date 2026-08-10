import { describe, expect, it, vi } from "vitest";
import { StaticComponentsService } from "./static-components.service";
import type { MatchingDataRepository } from "../repositories/matching-data.repository";

function fakeRepository(overrides: Partial<Record<keyof MatchingDataRepository, unknown>> = {}) {
  const base = {
    loadProfileScoringFields: vi.fn(async (userIds: string[]) => {
      const map = new Map();
      for (const id of userIds) {
        map.set(id, {
          yearsExperience: id === "viewer" ? 3 : 5,
          industryId: 1,
          verificationLevel: "L2",
          createdAt: new Date(),
        });
      }
      return map;
    }),
    loadSkillBundles: vi.fn(async (userIds: string[]) => {
      const map = new Map();
      for (const id of userIds) {
        map.set(id, {
          names: id === "viewer" ? ["Python", "SQL"] : ["Python", "React"],
          functionalAreas: ["engineering"],
          meanEmbedding: null,
        });
      }
      return map;
    }),
    loadInterests: vi.fn(async (userIds: string[]) => {
      const map = new Map();
      for (const id of userIds)
        map.set(id, id === "viewer" ? ["hiking", "chess"] : ["chess", "reading"]);
      return map;
    }),
    loadLanguages: vi.fn(async (userIds: string[]) => {
      const map = new Map();
      for (const id of userIds) map.set(id, [{ code: "en", proficiency: "native" as const }]);
      return map;
    }),
    loadProfileEmbeddings: vi.fn(async () => new Map()),
    loadAvailabilityLive: vi.fn(async () => new Map()),
    loadIntentRefs: vi.fn(async (userId: string) =>
      userId === "viewer"
        ? [{ type: "coffee_chat", isPrimary: true }]
        : [{ type: "coffee_chat", isPrimary: true }],
    ),
    loadMutualConnectionCount: vi.fn(async () => 2),
    loadIndustryAdjacency: vi.fn(async () => ({
      sameIndustry: true,
      adjacencyValue: 1.0,
      domainOverlap: 0.85,
    })),
    loadIntentMetadata: vi.fn(async () => ({})),
  };
  return { ...base, ...overrides } as unknown as MatchingDataRepository;
}

describe("StaticComponentsService", () => {
  it("computes all six static sub-scores and a renormalised staticScore", async () => {
    const service = new StaticComponentsService(fakeRepository());
    const result = await service.compute("viewer", "candidate");

    expect(result.components.industry).toBe(1.0); // same industry
    expect(result.components.lang).toBe(1.0); // shared native English
    expect(result.components.mutual).toBeCloseTo(Math.log1p(2) / Math.log1p(8), 10);
    expect(result.components.skill).toBeGreaterThan(0); // shared "Python"
    expect(result.components.interest).toBeGreaterThan(0); // shared "chess"
    expect(result.components.exp).toBeGreaterThan(0);
    expect(result.staticScore).toBeGreaterThan(0);
    expect(result.staticScore).toBeLessThanOrEqual(1);
  });

  it("uses skillsScore's cofounder branch (via cofounderComplementarity) when both sides want a cofounder", async () => {
    const repo = fakeRepository({
      loadIntentRefs: vi.fn(async () => [{ type: "need_cofounder", isPrimary: true }]),
    });
    const service = new StaticComponentsService(repo);
    const result = await service.compute("viewer", "candidate");

    // domainOverlap 0.85, functionOverlap 1.0 (both "engineering") ->
    // 0.55*0.85 + 0.45*0 = 0.4675
    expect(result.components.skill).toBeCloseTo(0.4675, 4);
  });

  it("falls back to the peer experience bucket when a hiring intent has no seniority_range in metadata", async () => {
    const repo = fakeRepository({
      loadIntentRefs: vi.fn(async (userId: string) =>
        userId === "viewer"
          ? [{ type: "hiring", isPrimary: true }]
          : [{ type: "looking_for_job", isPrimary: true }],
      ),
    });
    const service = new StaticComponentsService(repo);

    // Would throw if experienceScore were called with the "hiring" family
    // and no seniorityRange — proving the fallback branch actually runs.
    await expect(service.compute("viewer", "candidate")).resolves.toBeDefined();
  });
});
