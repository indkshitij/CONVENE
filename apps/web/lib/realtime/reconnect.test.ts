import { describe, expect, it } from "vitest";
import { baseDelayForAttempt, nextBackoffDelayMs } from "./reconnect";

describe("baseDelayForAttempt", () => {
  // §17.5/§10.7.5: "exponential backoff 1->2->4->8->16->30s."
  it.each([
    [0, 1000],
    [1, 2000],
    [2, 4000],
    [3, 8000],
    [4, 16000],
    [5, 30000],
  ])("attempt %i => %ims base delay", (attempt, expected) => {
    expect(baseDelayForAttempt(attempt)).toBe(expected);
  });

  it("caps at 30s for any attempt beyond the schedule", () => {
    expect(baseDelayForAttempt(6)).toBe(30000);
    expect(baseDelayForAttempt(100)).toBe(30000);
  });

  it("floors at attempt 0 for a negative attempt", () => {
    expect(baseDelayForAttempt(-1)).toBe(1000);
  });
});

describe("nextBackoffDelayMs", () => {
  it("applies ±20% jitter around the base delay", () => {
    const base = baseDelayForAttempt(2); // 4000ms
    const atMin = nextBackoffDelayMs(2, () => 0);
    const atMax = nextBackoffDelayMs(2, () => 1);
    const atMid = nextBackoffDelayMs(2, () => 0.5);
    expect(atMin).toBeCloseTo(base * 0.8, 5);
    expect(atMax).toBeCloseTo(base * 1.2, 5);
    expect(atMid).toBeCloseTo(base, 5);
  });

  it("never produces a delay outside the ±20% band across many random draws", () => {
    const base = baseDelayForAttempt(4); // 16000ms
    for (let i = 0; i < 200; i += 1) {
      const delay = nextBackoffDelayMs(4);
      expect(delay).toBeGreaterThanOrEqual(base * 0.8 - 1e-6);
      expect(delay).toBeLessThanOrEqual(base * 1.2 + 1e-6);
    }
  });
});
