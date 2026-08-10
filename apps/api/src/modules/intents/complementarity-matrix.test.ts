import { DEFAULT_COMPLEMENTARITY_MATRIX, INTENT_TYPES, type IntentType } from "@convene/matching";
import { describe, expect, it } from "vitest";
import { buildMatrixFromRows, findBestPair } from "./complementarity-matrix";

function allZeroRows(): { fromType: IntentType; toType: IntentType; weight: number }[] {
  const rows: { fromType: IntentType; toType: IntentType; weight: number }[] = [];
  for (const fromType of INTENT_TYPES) {
    for (const toType of INTENT_TYPES) {
      rows.push({ fromType, toType, weight: 0 });
    }
  }
  return rows;
}

describe("buildMatrixFromRows", () => {
  it("falls back to DEFAULT_COMPLEMENTARITY_MATRIX entirely when the DB has no rows", () => {
    const matrix = buildMatrixFromRows([]);
    expect(matrix).toEqual(DEFAULT_COMPLEMENTARITY_MATRIX);
  });

  it("overrides only the specific cell a DB row provides, leaving the rest at their default", () => {
    const matrix = buildMatrixFromRows([
      { fromType: "looking_for_job", toType: "hiring", weight: "0.42" },
    ]);
    expect(matrix.looking_for_job.hiring).toBe(0.42);
    expect(matrix.looking_for_job.need_cofounder).toBe(
      DEFAULT_COMPLEMENTARITY_MATRIX.looking_for_job.need_cofounder,
    );
    expect(matrix.hiring).toEqual(DEFAULT_COMPLEMENTARITY_MATRIX.hiring);
  });

  it("is asymmetric by construction: overriding A->B leaves B->A untouched", () => {
    const matrix = buildMatrixFromRows([
      { fromType: "looking_for_job", toType: "hiring", weight: "0.99" },
    ]);
    expect(matrix.looking_for_job.hiring).toBe(0.99);
    expect(matrix.hiring.looking_for_job).toBe(
      DEFAULT_COMPLEMENTARITY_MATRIX.hiring.looking_for_job,
    );
    expect(matrix.looking_for_job.hiring).not.toBe(matrix.hiring.looking_for_job);
  });
});

describe("findBestPair", () => {
  it("returns null when no non-zero pair exists", () => {
    const zeroMatrix = buildMatrixFromRows(allZeroRows());
    expect(
      findBestPair(
        [{ type: "coffee_chat", isPrimary: false }],
        [{ type: "coffee_chat", isPrimary: false }],
        zeroMatrix,
      ),
    ).toBeNull();
  });

  it("picks the single highest-weight pair across viewer x candidate intents", () => {
    const result = findBestPair(
      [
        { type: "need_mentor", isPrimary: false },
        { type: "coffee_chat", isPrimary: false },
      ],
      [
        { type: "need_mentee", isPrimary: false },
        { type: "learning", isPrimary: false },
      ],
      DEFAULT_COMPLEMENTARITY_MATRIX,
    );
    expect(result).toEqual({
      viewerType: "need_mentor",
      candidateType: "need_mentee",
      weight: 1.0,
    });
  });
});

// P8.2's own testing requirement: "Assert asymmetry (looking_for_job→hiring
// ≠ hiring→looking_for_job where documented)." looking_for_job<->hiring is
// actually symmetric in this matrix (both 1.0 — the PRD's own "where
// documented" qualifier flags that not every pair is asymmetric);
// need_mentor<->internship is a pair the matrix genuinely does document
// asymmetrically.
describe("DEFAULT_COMPLEMENTARITY_MATRIX asymmetry", () => {
  it("need_mentor -> internship differs from internship -> need_mentor", () => {
    expect(DEFAULT_COMPLEMENTARITY_MATRIX.need_mentor.internship).not.toBe(
      DEFAULT_COMPLEMENTARITY_MATRIX.internship.need_mentor,
    );
  });

  it("the matrix is not fully symmetric (at least one asymmetric pair exists)", () => {
    const isFullySymmetric = INTENT_TYPES.every((a) =>
      INTENT_TYPES.every(
        (b) => DEFAULT_COMPLEMENTARITY_MATRIX[a][b] === DEFAULT_COMPLEMENTARITY_MATRIX[b][a],
      ),
    );
    expect(isFullySymmetric).toBe(false);
  });
});
