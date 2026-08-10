import {
  DEFAULT_COMPLEMENTARITY_MATRIX,
  type ComplementarityMatrix,
  type IntentRef,
  type IntentType,
} from "@convene/matching";

export interface ComplementarityRow {
  fromType: string;
  toType: string;
  weight: string | number;
}

// PRD §10.4.7: intent_complementarity is "seeded, remote-config
// overridable" — the DB table (packages/db/seeds/complementarity.ts
// loads the full 14x14 fixture into it) is the live-editable source of
// truth; packages/matching's DEFAULT_COMPLEMENTARITY_MATRIX is the
// code-level fallback. Falls back per-cell (not all-or-nothing) so a
// partially-seeded table still produces a complete matrix.
export function buildMatrixFromRows(rows: ComplementarityRow[]): ComplementarityMatrix {
  const byFrom = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!byFrom.has(row.fromType)) byFrom.set(row.fromType, new Map());
    byFrom.get(row.fromType)!.set(row.toType, Number(row.weight));
  }

  const result = {} as ComplementarityMatrix;
  for (const fromType of Object.keys(DEFAULT_COMPLEMENTARITY_MATRIX) as IntentType[]) {
    const defaults = DEFAULT_COMPLEMENTARITY_MATRIX[fromType];
    const overrides = byFrom.get(fromType);
    const row = {} as Record<IntentType, number>;
    for (const toType of Object.keys(defaults) as IntentType[]) {
      row[toType] = overrides?.get(toType) ?? defaults[toType];
    }
    result[fromType] = row;
  }
  return result;
}

export interface BestPair {
  viewerType: IntentType;
  candidateType: IntentType;
  weight: number;
}

// Distinct from packages/matching's intentScore(): that returns the
// aggregate score (multi-pair bonus, primary multiplier, etc. all
// folded in); this returns *which* single pair drove the raw
// complementarity, for match-reason generation ("your need_mentor
// complements their need_mentee") where the aggregate number alone
// doesn't say which two intents to name.
export function findBestPair(
  viewerIntents: readonly IntentRef[],
  candidateIntents: readonly IntentRef[],
  matrix: ComplementarityMatrix,
): BestPair | null {
  let best: BestPair | null = null;
  for (const iv of viewerIntents) {
    for (const ic of candidateIntents) {
      const weight = matrix[iv.type][ic.type];
      if (weight > 0 && (best === null || weight > best.weight)) {
        best = { viewerType: iv.type, candidateType: ic.type, weight };
      }
    }
  }
  return best;
}
