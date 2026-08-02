import { describe, expect, it } from "vitest";
import { loadIntentComplementarity } from "./complementarity";

describe("intent complementarity fixture (PRD §11.5.2)", () => {
  it("loads the full 14x14 matrix (196 entries)", () => {
    const rows = loadIntentComplementarity();
    expect(rows).toHaveLength(196);
  });

  it("every weight is within [0, 1]", () => {
    const rows = loadIntentComplementarity();
    expect(rows.every((row) => row.weight >= 0 && row.weight <= 1)).toBe(true);
  });

  it("is genuinely asymmetric for at least one pair, as the PRD describes", () => {
    const rows = loadIntentComplementarity();
    const find = (from: string, to: string) =>
      rows.find((row) => row.fromType === from && row.toType === to)?.weight;

    // internship -> startup_discussion (0.25) differs from the reverse (0.20).
    expect(find("internship", "startup_discussion")).toBe(0.25);
    expect(find("startup_discussion", "internship")).toBe(0.2);
    // need_cofounder <-> need_cofounder is the special 1.00 x skill-complementarity case
    expect(find("need_cofounder", "need_cofounder")).toBe(1.0);
  });

  it("has no zero-weight entries (table shows every cell populated)", () => {
    const rows = loadIntentComplementarity();
    expect(rows.every((row) => row.weight > 0)).toBe(true);
  });
});
