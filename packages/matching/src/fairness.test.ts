import { describe, expect, it } from "vitest";
import { FAIRNESS_DEVIATION_THRESHOLD, computeFairnessShares } from "./fairness";

describe("computeFairnessShares", () => {
  it("does not flag a group whose impression share tracks its population share", () => {
    const rows = computeFairnessShares([
      { group: "L0", impressionCount: 50, populationCount: 50 },
      { group: "L1", impressionCount: 50, populationCount: 50 },
    ]);
    for (const row of rows) expect(row.flagged).toBe(false);
  });

  it("flags a synthetic skew: one group gets far more impression share than its population share", () => {
    // Population is 50/50 split, but impressions are 90/10 — a massive
    // skew toward "L4", well past the 25% relative-deviation threshold.
    const rows = computeFairnessShares([
      { group: "L4", impressionCount: 90, populationCount: 50 },
      { group: "L0", impressionCount: 10, populationCount: 50 },
    ]);
    const l4 = rows.find((r) => r.group === "L4")!;
    const l0 = rows.find((r) => r.group === "L0")!;

    expect(l4.impressionShare).toBeCloseTo(0.9, 5);
    expect(l4.populationShare).toBeCloseTo(0.5, 5);
    expect(l4.relativeDeviation).toBeCloseTo(0.8, 5); // |0.9-0.5|/0.5
    expect(l4.flagged).toBe(true);
    expect(l0.flagged).toBe(true); // symmetric under-representation
  });

  it("does not flag a deviation right at the threshold boundary", () => {
    // relativeDeviation exactly 0.25 should NOT be flagged (">" not ">=").
    const rows = computeFairnessShares([
      { group: "A", impressionCount: 62.5, populationCount: 50 }, // share 0.625 vs 0.5 -> deviation exactly 0.25
      { group: "B", impressionCount: 37.5, populationCount: 50 },
    ]);
    const a = rows.find((r) => r.group === "A")!;
    expect(a.relativeDeviation).toBeCloseTo(FAIRNESS_DEVIATION_THRESHOLD, 5);
    expect(a.flagged).toBe(false);
  });

  it("treats impressions with zero population share as an infinite (flagged) deviation", () => {
    const rows = computeFairnessShares([
      { group: "ghost", impressionCount: 10, populationCount: 0 },
      { group: "real", impressionCount: 90, populationCount: 100 },
    ]);
    const ghost = rows.find((r) => r.group === "ghost")!;
    expect(ghost.populationShare).toBe(0);
    expect(ghost.relativeDeviation).toBe(Infinity);
    expect(ghost.flagged).toBe(true);
  });

  it("returns share 0 and no flag for a group with neither impressions nor population", () => {
    const rows = computeFairnessShares([
      { group: "empty", impressionCount: 0, populationCount: 0 },
    ]);
    expect(rows[0]!.flagged).toBe(false);
  });
});
