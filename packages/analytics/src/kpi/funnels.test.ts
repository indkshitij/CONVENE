import { describe, expect, it } from "vitest";
import { ACQUISITION_FUNNEL, computeFunnelConversion, type FunnelStepEvent } from "./funnels";

describe("computeFunnelConversion", () => {
  it("computes reached counts and step-over-step conversion for a simple funnel", () => {
    const events: FunnelStepEvent[] = [
      // user-1 makes it all the way through
      { userId: "user-1", step: "landing_viewed", timestamp: new Date("2026-01-01") },
      { userId: "user-1", step: "signup_started", timestamp: new Date("2026-01-01") },
      { userId: "user-1", step: "verification_completed", timestamp: new Date("2026-01-01") },
      // user-2 drops off after landing
      { userId: "user-2", step: "landing_viewed", timestamp: new Date("2026-01-01") },
      // user-3 drops off after signup
      { userId: "user-3", step: "landing_viewed", timestamp: new Date("2026-01-01") },
      { userId: "user-3", step: "signup_started", timestamp: new Date("2026-01-01") },
    ];

    const results = computeFunnelConversion(ACQUISITION_FUNNEL.slice(0, 3), events);

    expect(results.map((r) => r.reached)).toEqual([3, 2, 1]);
    expect(results[0]!.conversionFromPrevious).toBeNull();
    expect(results[1]!.conversionFromPrevious).toBeCloseTo(2 / 3);
    expect(results[2]!.conversionFromPrevious).toBeCloseTo(1 / 2);
    expect(results[2]!.conversionFromStart).toBeCloseTo(1 / 3);
  });

  it("is strict: reaching a later step without the earlier ones doesn't count toward the earlier step, but a later step still requires all its prerequisites", () => {
    const events: FunnelStepEvent[] = [
      // Only ever fires the last step — a data anomaly this funnel must not credit for step 1 or 2.
      {
        userId: "anomalous-user",
        step: "verification_completed",
        timestamp: new Date("2026-01-01"),
      },
    ];
    const results = computeFunnelConversion(ACQUISITION_FUNNEL.slice(0, 3), events);
    expect(results.map((r) => r.reached)).toEqual([0, 0, 0]);
  });

  it("returns zero conversion rates (not NaN/Infinity) when no one enters the funnel", () => {
    const results = computeFunnelConversion(ACQUISITION_FUNNEL.slice(0, 2), []);
    expect(results.every((r) => Number.isFinite(r.conversionFromStart))).toBe(true);
  });
});
