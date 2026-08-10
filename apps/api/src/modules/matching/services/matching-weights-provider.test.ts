import { auditLogs } from "@convene/db";
import { DEFAULT_WEIGHTS } from "@convene/matching";
import { describe, expect, it, vi } from "vitest";
import { MatchingWeightsProvider } from "./matching-weights-provider";
import type { CacheService } from "../../../common/cache/cache.service";
import type { PostgresService } from "../../../infra/postgres/postgres.service";

function fakeCache(): CacheService {
  const store = new Map<string, unknown>();
  return {
    getOrSet: vi.fn(async (key: string, _ttl: number, factory: () => Promise<unknown>) => {
      if (store.has(key)) return store.get(key);
      const value = await factory();
      store.set(key, value);
      return value;
    }),
    invalidate: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as CacheService;
}

// `recentRows` is every matching_weight_configs row ordered
// most-recent-first — in the real table exactly one row is ever active,
// and it's always the most recently inserted (the transaction that
// inserts a new active row always deactivates the old one first), so
// "the active row" and "the most recent row" are the same row. Both
// getActiveWeights()'s `.where(isActive).orderBy().limit(1)` and
// rollbackWeights()'s `.orderBy().limit(2)` (no where — it needs the
// row *before* the active one too) are faithfully served from the same
// ordered list here.
function fakePostgres(recentRows: { weights: unknown }[]) {
  const auditRows: unknown[] = [];
  const configUpdates: unknown[] = [];
  const configInserts: unknown[] = [];

  function limitable() {
    return {
      orderBy: () => ({
        limit: async (n: number) => recentRows.slice(0, n),
      }),
    };
  }

  const db = {
    select: () => ({
      from: () => ({
        where: () => limitable(),
        ...limitable(),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        auditRows.push({ table, values });
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: unknown) => ({
            where: async () => {
              configUpdates.push(values);
            },
          }),
        }),
        insert: (table: unknown) => ({
          values: (values: unknown) => {
            if (table === auditLogs) {
              auditRows.push({ table, values });
              return Promise.resolve(undefined);
            }
            return {
              returning: async () => {
                configInserts.push(values);
                return [{ id: "config-1" }];
              },
            };
          },
        }),
      };
      await fn(tx);
    },
  };
  return {
    postgres: { db } as unknown as PostgresService,
    auditRows,
    configUpdates,
    configInserts,
  };
}

describe("MatchingWeightsProvider", () => {
  it("falls back to DEFAULT_WEIGHTS when no config has ever been activated", async () => {
    const { postgres } = fakePostgres([]);
    const provider = new MatchingWeightsProvider(postgres, fakeCache());

    const weights = await provider.getActiveWeights();
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });

  it("returns the active config's weights when one exists", async () => {
    const customWeights = { ...DEFAULT_WEIGHTS, avail: 0.3, intent: 0.16 };
    const { postgres } = fakePostgres([{ weights: customWeights }]);
    const provider = new MatchingWeightsProvider(postgres, fakeCache());

    const weights = await provider.getActiveWeights();
    expect(weights).toEqual(customWeights);
  });

  // Explicit acceptance criterion: "Assert 0.99 and 1.01 are both rejected."
  // DEFAULT_WEIGHTS sums to exactly 1.00 (avail=0.22); nudging `avail` by
  // ∓0.01 produces a total of 0.99/1.01 respectively.
  it.each([
    ["0.99", 0.21],
    ["1.01", 0.23],
  ])("rejects a proposal that sums to ~%s (avail nudged to %s)", async (_label, avail) => {
    const { postgres } = fakePostgres([]);
    const provider = new MatchingWeightsProvider(postgres, fakeCache());

    const result = await provider.proposeWeights(
      { ...DEFAULT_WEIGHTS, avail },
      "admin-1",
      "Testing the boundary.",
    );
    expect(result.accepted).toBe(false);
  });

  it("rejects an out-of-sum proposal, writes an audit log, and leaves the active config untouched", async () => {
    const { postgres } = fakePostgres([]);
    const provider = new MatchingWeightsProvider(postgres, fakeCache());

    const invalid = { ...DEFAULT_WEIGHTS, avail: 0.9 };
    const result = await provider.proposeWeights(
      invalid,
      "admin-1",
      "Testing an out-of-sum change.",
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/must sum to 1\.00/);
    // The still-active config after rejection is exactly what it was before.
    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    expect(await provider.getActiveWeights()).toEqual(DEFAULT_WEIGHTS);
  });

  it("accepts a valid proposal, deactivates the previous config, and activates the new one", async () => {
    const valid = { ...DEFAULT_WEIGHTS, avail: 0.21, intent: 0.25 };
    const { postgres, configUpdates, configInserts } = fakePostgres([]);
    const provider = new MatchingWeightsProvider(postgres, fakeCache());

    const result = await provider.proposeWeights(
      valid,
      "admin-1",
      "Boosting availability relative to intent.",
    );

    expect(result.accepted).toBe(true);
    expect(result.weights).toEqual(valid);
    expect(configUpdates).toEqual([{ isActive: false }]);
    expect(configInserts).toEqual([{ weights: valid, isActive: true, createdBy: "admin-1" }]);
  });

  it("stores the admin's change reason on the accepted audit row, but not on a rejected one (nothing took effect to attach it to)", async () => {
    const { postgres, auditRows } = fakePostgres([]);
    const provider = new MatchingWeightsProvider(postgres, fakeCache());

    await provider.proposeWeights(
      { ...DEFAULT_WEIGHTS, avail: 0.21, intent: 0.25 },
      "admin-1",
      "Boosting availability.",
    );
    const acceptedRow = auditRows.find(
      (r) => (r as { values: { action: string } }).values.action === "matching_weights.updated",
    );
    expect((acceptedRow as { values: { reason: string } }).values.reason).toBe(
      "Boosting availability.",
    );
  });

  it("writes an audit log entry for both accepted and rejected proposals", async () => {
    const { postgres: rejectedPg, auditRows: rejectedAudit } = fakePostgres([]);
    await new MatchingWeightsProvider(rejectedPg, fakeCache()).proposeWeights(
      { ...DEFAULT_WEIGHTS, avail: 0.9 },
      "admin-1",
      "Testing.",
    );
    expect(
      rejectedAudit.some(
        (r) => (r as { values: { action: string } }).values.action === "matching_weights.rejected",
      ),
    ).toBe(true);

    const { postgres: acceptedPg, auditRows: acceptedAudit } = fakePostgres([]);
    await new MatchingWeightsProvider(acceptedPg, fakeCache()).proposeWeights(
      { ...DEFAULT_WEIGHTS, avail: 0.21, intent: 0.25 },
      "admin-1",
      "Testing.",
    );
    expect(
      acceptedAudit.some(
        (r) => (r as { values: { action: string } }).values.action === "matching_weights.updated",
      ),
    ).toBe(true);
  });

  // Explicit acceptance criterion: "Assert rollback restores the prior
  // values and logs it."
  describe("rollbackWeights", () => {
    it("restores the configuration before the current active one", async () => {
      const priorWeights = { ...DEFAULT_WEIGHTS, avail: 0.3, intent: 0.16 };
      const currentWeights = { ...DEFAULT_WEIGHTS, avail: 0.21, intent: 0.25 };
      const { postgres, configUpdates, configInserts } = fakePostgres([
        { weights: currentWeights },
        { weights: priorWeights },
      ]);
      const provider = new MatchingWeightsProvider(postgres, fakeCache());

      const result = await provider.rollbackWeights(
        "admin-2",
        "Reverting last night's regression.",
      );

      expect(result.accepted).toBe(true);
      expect(result.weights).toEqual(priorWeights);
      expect(configUpdates).toEqual([{ isActive: false }]);
      expect(configInserts).toEqual([
        { weights: priorWeights, isActive: true, createdBy: "admin-2" },
      ]);
    });

    it("logs the rollback to the audit trail with before/after and the stated reason", async () => {
      const priorWeights = { ...DEFAULT_WEIGHTS, avail: 0.3, intent: 0.16 };
      const currentWeights = { ...DEFAULT_WEIGHTS, avail: 0.21, intent: 0.25 };
      const { postgres, auditRows } = fakePostgres([
        { weights: currentWeights },
        { weights: priorWeights },
      ]);
      const provider = new MatchingWeightsProvider(postgres, fakeCache());

      await provider.rollbackWeights("admin-2", "Reverting last night's regression.");

      const row = auditRows.find(
        (r) =>
          (r as { values: { action: string } }).values.action === "matching_weights.rolled_back",
      ) as { values: { reason: string; before: unknown; after: unknown } } | undefined;
      expect(row?.values.reason).toBe("Reverting last night's regression.");
      expect(row?.values.before).toEqual(currentWeights);
      expect(row?.values.after).toEqual(priorWeights);
    });

    it("rejects a rollback when there's no prior configuration to restore", async () => {
      const { postgres } = fakePostgres([{ weights: DEFAULT_WEIGHTS }]);
      const provider = new MatchingWeightsProvider(postgres, fakeCache());

      await expect(provider.rollbackWeights("admin-2", "Trying anyway.")).rejects.toMatchObject({
        code: "NO_PREVIOUS_WEIGHTS_CONFIG",
      });
    });
  });
});
