import { describe, expect, it } from "vitest";
import { activityScore } from "./activity";

describe("activityScore", () => {
  it("returns 1.0 at or above the 10-day / 6-session caps", () => {
    const score = activityScore({ activeDaysLast14: 10, availabilitySessionsLast14: 6 });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("caps active days at 10 even if more are reported", () => {
    const score = activityScore({ activeDaysLast14: 14, availabilitySessionsLast14: 6 });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("caps availability sessions at 6 even if more are reported", () => {
    const score = activityScore({ activeDaysLast14: 10, availabilitySessionsLast14: 20 });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("blends both components 0.5/0.5 below the caps", () => {
    const score = activityScore({ activeDaysLast14: 5, availabilitySessionsLast14: 3 });
    expect(score).toBeCloseTo(0.5 * (5 / 10) + 0.5 * (3 / 6), 5);
  });

  it("returns 0 for no activity at all", () => {
    expect(activityScore({ activeDaysLast14: 0, availabilitySessionsLast14: 0 })).toBe(0);
  });
});
