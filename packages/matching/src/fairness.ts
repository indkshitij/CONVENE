// PRD §11.11: "Quarterly: score distribution by years-of-experience
// decile, city tier, verification level, and gender (inferred only in
// aggregate for audit, never stored per user). Flag any group whose
// median impression share deviates > 25% from its population share."
// P12.3's own prompt narrows the dimension list to "verification level,
// city, experience band and reputation band" (no gender/decile-level
// granularity) — followed here since it's the more specific, later
// instruction; gender inference isn't built anywhere in this codebase and
// isn't reintroduced speculatively.
export const FAIRNESS_DEVIATION_THRESHOLD = 0.25;

export interface FairnessGroupInput {
  group: string;
  impressionCount: number;
  populationCount: number;
}

export interface FairnessGroupResult extends FairnessGroupInput {
  impressionShare: number;
  populationShare: number;
  /** |impressionShare - populationShare| / populationShare — Infinity when populationShare is 0 but impressions exist. */
  relativeDeviation: number;
  flagged: boolean;
}

// Pure aggregation over already-counted rows (the SQL GROUP BY is the
// caller's job — this package has no I/O) — deliberately separated from
// the DB query so "does a skew get flagged" is testable without Postgres.
export function computeFairnessShares(rows: readonly FairnessGroupInput[]): FairnessGroupResult[] {
  const totalImpressions = rows.reduce((sum, row) => sum + row.impressionCount, 0);
  const totalPopulation = rows.reduce((sum, row) => sum + row.populationCount, 0);

  return rows.map((row) => {
    const impressionShare = totalImpressions > 0 ? row.impressionCount / totalImpressions : 0;
    const populationShare = totalPopulation > 0 ? row.populationCount / totalPopulation : 0;
    const relativeDeviation =
      populationShare > 0
        ? Math.abs(impressionShare - populationShare) / populationShare
        : impressionShare > 0
          ? Infinity
          : 0;

    return {
      ...row,
      impressionShare,
      populationShare,
      relativeDeviation,
      flagged: relativeDeviation > FAIRNESS_DEVIATION_THRESHOLD,
    };
  });
}
