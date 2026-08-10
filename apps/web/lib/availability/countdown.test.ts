import { describe, expect, it } from "vitest";
import { computeCountdown, formatCountdown } from "./countdown";

describe("computeCountdown", () => {
  it("derives remaining time from the server's expires_at and the given now, never from a client-side origin skew could shift", () => {
    const expiresAt = "2026-01-01T00:30:00.000Z";
    const normalNow = () => new Date("2026-01-01T00:20:00.000Z").getTime(); // 10 min left
    // A skewed client clock (set back 10 minutes) — if the countdown were
    // computed from "duration + a client-recorded start time," this would
    // corrupt the session length. Because computeCountdown always targets
    // the same absolute expires_at, the skew only changes what *appears*
    // remaining from this new (wrong) now, never the target itself — the
    // server's own expiry is what the API will actually enforce
    // regardless of what this function reports.
    const skewedNow = () => new Date("2026-01-01T00:10:00.000Z").getTime();

    expect(computeCountdown(expiresAt, normalNow).remainingMs).toBe(10 * 60 * 1000);
    expect(computeCountdown(expiresAt, skewedNow).remainingMs).toBe(20 * 60 * 1000);
  });

  it("never goes negative once expired", () => {
    const expiresAt = "2026-01-01T00:30:00.000Z";
    const wayAfter = () => new Date("2026-01-01T01:00:00.000Z").getTime();
    expect(computeCountdown(expiresAt, wayAfter).remainingMs).toBe(0);
  });

  it("isExpiringSoon is true at exactly 5:00 remaining and false just above it", () => {
    const expiresAt = "2026-01-01T00:30:00.000Z";
    const atFiveMin = () => new Date("2026-01-01T00:25:00.000Z").getTime();
    const justAboveFiveMin = () => new Date("2026-01-01T00:24:59.000Z").getTime();

    expect(computeCountdown(expiresAt, atFiveMin).isExpiringSoon).toBe(true);
    expect(computeCountdown(expiresAt, justAboveFiveMin).isExpiringSoon).toBe(false);
  });

  it("isExpiringSoon is false once actually expired (isExpired takes precedence)", () => {
    const expiresAt = "2026-01-01T00:30:00.000Z";
    const after = () => new Date("2026-01-01T00:30:01.000Z").getTime();
    const result = computeCountdown(expiresAt, after);
    expect(result.isExpired).toBe(true);
    expect(result.isExpiringSoon).toBe(false);
  });
});

describe("formatCountdown", () => {
  it("formats sub-hour durations as mm:ss", () => {
    expect(formatCountdown(24 * 60 * 1000 + 18 * 1000)).toBe("24:18");
    expect(formatCountdown(5 * 1000)).toBe("00:05");
  });

  it("formats hour-plus durations as h:mm:ss", () => {
    expect(formatCountdown(90 * 60 * 1000)).toBe("1:30:00");
  });

  it("rounds down to the nearest second (never shows more time than actually remains)", () => {
    expect(formatCountdown(59_999)).toBe("00:59");
  });
});
