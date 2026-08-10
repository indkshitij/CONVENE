import { describe, expect, it, vi } from "vitest";
import { FeedImpressionsService } from "./feed-impressions.service";

const now = new Date("2026-08-08T00:00:00Z");
const clock = { now: () => now };

function fakePostgres(rows: Array<{ candidateId: string; count: number; interacted: boolean }>) {
  const db = {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  };
  return { db } as never;
}

describe("FeedImpressionsService", () => {
  it("getFatigueMultipliers maps impression counts through fatigueMultiplier, defaulting to 1.0 for never-shown candidates", async () => {
    const postgres = fakePostgres([
      { candidateId: "c1", count: 1, interacted: false },
      { candidateId: "c2", count: 4, interacted: false },
      { candidateId: "c3", count: 8, interacted: false },
    ]);
    const service = new FeedImpressionsService(postgres, clock);

    const result = await service.getFatigueMultipliers("viewer-1", ["c1", "c2", "c3", "c4"]);

    expect(result.get("c1")).toBe(1.0);
    expect(result.get("c2")).toBe(0.85);
    expect(result.get("c3")).toBe(0.7);
    expect(result.get("c4")).toBe(1.0); // never shown
  });

  it("returns an empty map for an empty candidate list without querying", async () => {
    const postgres = fakePostgres([]);
    const service = new FeedImpressionsService(postgres, clock);
    const result = await service.getFatigueMultipliers("viewer-1", []);
    expect(result.size).toBe(0);
  });
});
