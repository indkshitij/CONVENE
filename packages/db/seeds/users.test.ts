import { describe, expect, it } from "vitest";
import { generateSeedPopulation } from "./users";

describe("generateSeedPopulation (P2.5)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = generateSeedPopulation(100, 42);
    const b = generateSeedPopulation(100, 42);
    expect(a).toEqual(b);
  });

  it("produces a different population for a different seed", () => {
    const a = generateSeedPopulation(100, 42);
    const b = generateSeedPopulation(100, 43);
    expect(a.users[0]?.email).not.toBe(b.users[0]?.email);
  });

  it("is Bengaluru-dense (a clear majority of users)", () => {
    const { users } = generateSeedPopulation(500, 42);
    const bengaluruShare = users.filter((u) => u.cityName === "Bengaluru").length / users.length;
    expect(bengaluruShare).toBeGreaterThan(0.5);
  });

  it("has roughly 15% available now", () => {
    const { users } = generateSeedPopulation(500, 42);
    const share = users.filter((u) => u.availableNow).length / users.length;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.25);
  });

  it("weights experience toward 0-8 years", () => {
    const { users } = generateSeedPopulation(500, 42);
    const under8Share = users.filter((u) => u.yearsExperience <= 8).length / users.length;
    expect(under8Share).toBeGreaterThan(0.7);
    const average = users.reduce((sum, u) => sum + u.yearsExperience, 0) / users.length;
    expect(average).toBeLessThan(8);
  });

  it("generates every user with at least one intent", () => {
    const { users } = generateSeedPopulation(200, 42);
    expect(users.every((u) => u.intents.length >= 1)).toBe(true);
  });

  it("produces connections, pending requests, and conversations with history", () => {
    const population = generateSeedPopulation(500, 42);
    expect(population.connections.length).toBeGreaterThan(0);
    expect(population.pendingRequests.length).toBeGreaterThan(0);
    expect(population.conversationsWithHistory.length).toBeGreaterThan(0);
    // Every conversation-with-history pair must also be a real connection.
    const connectionKeys = new Set(
      population.connections.map((c) => `${c.userIndexA}-${c.userIndexB}`),
    );
    expect(
      population.conversationsWithHistory.every((c) =>
        connectionKeys.has(`${c.userIndexA}-${c.userIndexB}`),
      ),
    ).toBe(true);
  });
});
