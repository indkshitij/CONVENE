import { describe, expect, it, vi } from "vitest";
import { MatchPrecomputeService } from "./match-precompute.service";
import type { CandidateRepository } from "../repositories/candidate.repository";
import type { MatchingDataRepository } from "../repositories/matching-data.repository";
import type { StaticComponentsService } from "./static-components.service";

const now = new Date("2026-08-08T00:00:00Z");

function fakePostgres(inserted: unknown[][]) {
  return {
    db: {
      insert: () => ({
        values: (rows: unknown[]) => {
          inserted.push(rows);
          return { onConflictDoUpdate: async () => undefined };
        },
      }),
    },
  } as never;
}

function fakeCandidateRepository(candidateIds: string[]): CandidateRepository {
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
    stage0: vi.fn(async () => candidateIds.map((userId) => ({ userId, distanceM: 1000 }))),
    stage1: vi.fn(async () => []),
    stage2: vi.fn(async () => []),
    stage3: vi.fn(async () => []),
    stage4: vi.fn(async () => []),
    stage5: vi.fn(async () => []),
  } as unknown as CandidateRepository;
}

describe("MatchPrecomputeService", () => {
  it("computes static components for every discovered candidate and upserts them", async () => {
    const inserted: unknown[][] = [];
    const staticComponents = {
      compute: vi.fn(async (_viewerId: string, candidateId: string) => ({
        components: { skill: 0.5, industry: 0.5, exp: 0.5, interest: 0.5, mutual: 0.5, lang: 0.5 },
        staticScore: 0.5,
      })),
    } as unknown as StaticComponentsService;

    const service = new MatchPrecomputeService(
      fakePostgres(inserted),
      fakeCandidateRepository(["c1", "c2", "c3"]),
      {} as MatchingDataRepository,
      staticComponents,
      { now: () => now },
    );

    const result = await service.precomputeForUser("viewer-1");

    expect(result.candidatesConsidered).toBe(3);
    expect(result.written).toBe(3);
    expect(staticComponents.compute).toHaveBeenCalledTimes(3);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(3);
  });

  it("skips a candidate whose static-components computation throws, without failing the whole run", async () => {
    const inserted: unknown[][] = [];
    const staticComponents = {
      compute: vi.fn(async (_viewerId: string, candidateId: string) => {
        if (candidateId === "c2") throw new Error("boom");
        return {
          components: {
            skill: 0.5,
            industry: 0.5,
            exp: 0.5,
            interest: 0.5,
            mutual: 0.5,
            lang: 0.5,
          },
          staticScore: 0.5,
        };
      }),
    } as unknown as StaticComponentsService;

    const service = new MatchPrecomputeService(
      fakePostgres(inserted),
      fakeCandidateRepository(["c1", "c2", "c3"]),
      {} as MatchingDataRepository,
      staticComponents,
      { now: () => now },
    );

    const result = await service.precomputeForUser("viewer-1");

    expect(result.candidatesConsidered).toBe(3);
    expect(result.written).toBe(2);
  });

  it("returns zero when the viewer has no resolvable location context", async () => {
    const inserted: unknown[][] = [];
    const candidateRepository = {
      resolveViewerContext: vi.fn(async () => null),
    } as unknown as CandidateRepository;

    const service = new MatchPrecomputeService(
      fakePostgres(inserted),
      candidateRepository,
      {} as MatchingDataRepository,
      {} as StaticComponentsService,
      { now: () => now },
    );

    const result = await service.precomputeForUser("viewer-1");
    expect(result).toEqual({ candidatesConsidered: 0, written: 0 });
  });

  it("precomputeForAllActiveUsers sums written rows across every active user", async () => {
    const inserted: unknown[][] = [];
    const staticComponents = {
      compute: vi.fn(async () => ({
        components: { skill: 0.5, industry: 0.5, exp: 0.5, interest: 0.5, mutual: 0.5, lang: 0.5 },
        staticScore: 0.5,
      })),
    } as unknown as StaticComponentsService;
    const dataRepository = {
      loadActiveUserIds: vi.fn(async () => ["u1", "u2"]),
    } as unknown as MatchingDataRepository;

    const service = new MatchPrecomputeService(
      fakePostgres(inserted),
      fakeCandidateRepository(["c1"]),
      dataRepository,
      staticComponents,
      { now: () => now },
    );

    const result = await service.precomputeForAllActiveUsers();
    expect(result.users).toBe(2);
    expect(result.written).toBe(2); // one candidate per user
  });
});
