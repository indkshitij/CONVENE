import { describe, expect, it } from "vitest";
import { availability } from "./availability";

describe("availability (docs/design.md §15.2)", () => {
  it("defines all five states", () => {
    expect(Object.keys(availability)).toEqual([
      "availableNow",
      "busy",
      "away",
      "scheduled",
      "offline",
    ]);
  });

  it("marks only the available-now state as pulsing", () => {
    expect(availability.availableNow.pulsing).toBe(true);
    expect(availability.busy.pulsing).toBe(false);
    expect(availability.away.pulsing).toBe(false);
    expect(availability.scheduled.pulsing).toBe(false);
    expect(availability.offline.pulsing).toBe(false);
  });

  it("matches the semantic color values from design.md §15.2", () => {
    expect(availability.availableNow.color.light).toBe("#15803D");
    expect(availability.busy.color.light).toBe("#B45309");
    expect(availability.scheduled.color.light).toBe("#1D4ED8");
  });
});
