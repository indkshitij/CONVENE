import { describe, expect, it } from "vitest";
import { scoreBand } from "./score-band";

describe("scoreBand", () => {
  it.each([
    [0, "0-39"],
    [39, "0-39"],
    [40, "40-54"],
    [54, "40-54"],
    [55, "55-69"],
    [69, "55-69"],
    [70, "70-84"],
    [84, "70-84"],
    [85, "85-100"],
    [100, "85-100"],
  ] as const)("scoreBand(%i) === %s", (score, expected) => {
    expect(scoreBand(score)).toBe(expected);
  });
});
