import { describe, expect, it } from "vitest";
import { locationScore } from "./location";

const BASE = { viewerRemotePreference: "hybrid" as const };

describe("locationScore", () => {
  it("returns 1.00 for tier 0 (same geohash5 / within 2km)", () => {
    expect(locationScore({ ...BASE, tier: 0 })).toBeCloseTo(1.0, 5);
  });

  it("returns 0.95 for tier 1 at the viewer's exact location (ratio 0)", () => {
    expect(locationScore({ ...BASE, tier: 1, tier1DistanceRatio: 0 })).toBeCloseTo(0.95, 5);
  });

  it("returns 0.80 for tier 1 at the radius edge (ratio 1)", () => {
    expect(locationScore({ ...BASE, tier: 1, tier1DistanceRatio: 1 })).toBeCloseTo(0.8, 5);
  });

  it("decays linearly for tier 1 at a midpoint ratio", () => {
    expect(locationScore({ ...BASE, tier: 1, tier1DistanceRatio: 0.5 })).toBeCloseTo(0.875, 5);
  });

  it("defaults tier 1's ratio to 0 (best case) when omitted", () => {
    expect(locationScore({ ...BASE, tier: 1 })).toBeCloseTo(0.95, 5);
  });

  it("returns 0.78 for tier 2 (same city)", () => {
    expect(locationScore({ ...BASE, tier: 2 })).toBeCloseTo(0.78, 5);
  });

  // PRD §11.6 worked example: Meera is "same country, different state" -> 0.40 (tier 4).
  it("returns 0.58 for tier 3 (same state/region)", () => {
    expect(locationScore({ ...BASE, tier: 3 })).toBeCloseTo(0.58, 5);
  });

  it("returns 0.40 for tier 4 (same country) — the §11.6 worked example", () => {
    expect(locationScore({ ...BASE, tier: 4 })).toBeCloseTo(0.4, 5);
  });

  it("returns 0.28 for tier 5 (same timezone band, global)", () => {
    expect(locationScore({ ...BASE, tier: 5 })).toBeCloseTo(0.28, 5);
  });

  it("returns 0.12 for tier 6 (global, poor timezone overlap)", () => {
    expect(locationScore({ ...BASE, tier: 6 })).toBeCloseTo(0.12, 5);
  });

  it("returns the 0.35 neutral score for a hidden location, overriding the tier", () => {
    expect(locationScore({ ...BASE, tier: 0, isHiddenLocation: true })).toBeCloseTo(0.35, 5);
  });

  it("floors at 0.55 when both viewer and candidate prefer remote", () => {
    // tier 6 alone would be 0.12; the "both remote" floor lifts it to 0.55.
    expect(locationScore({ ...BASE, tier: 6, bothRemotePreference: true })).toBeCloseTo(0.55, 5);
  });

  it("does not lower a tier score that already exceeds the both-remote floor", () => {
    expect(locationScore({ ...BASE, tier: 0, bothRemotePreference: true })).toBeCloseTo(1.0, 5);
  });

  it("floors at 0.70 when the candidate is open to relocating to the viewer's city", () => {
    expect(
      locationScore({ ...BASE, tier: 6, candidateOpenToRelocateToViewerCity: true }),
    ).toBeCloseTo(0.7, 5);
  });

  it("does not lower a tier score that already exceeds the relocate floor", () => {
    expect(
      locationScore({ ...BASE, tier: 0, candidateOpenToRelocateToViewerCity: true }),
    ).toBeCloseTo(1.0, 5);
  });

  it("compresses the score toward 1.0 when the viewer's remote_preference is remote", () => {
    const score = locationScore({ tier: 4, viewerRemotePreference: "remote" });
    expect(score).toBeCloseTo(0.4 + 0.6 * 0.4, 5);
  });

  it("sharpens (lowers) the score when the viewer's remote_preference is onsite", () => {
    const score = locationScore({ tier: 4, viewerRemotePreference: "onsite" });
    expect(score).toBeCloseTo(Math.pow(0.4, 1.4), 5);
  });

  it("leaves the score unmodified for hybrid or any preference", () => {
    expect(locationScore({ tier: 4, viewerRemotePreference: "hybrid" })).toBeCloseTo(0.4, 5);
    expect(locationScore({ tier: 4, viewerRemotePreference: "any" })).toBeCloseTo(0.4, 5);
  });

  it("applies the 0.75 penalty when timezone overlap is under 2h and the candidate is scheduled-only", () => {
    const score = locationScore({
      ...BASE,
      tier: 4,
      timezoneOverlapHours: 1,
      candidateIsScheduledOnly: true,
    });
    expect(score).toBeCloseTo(0.4 * 0.75, 5);
  });

  it("does not apply the penalty when timezone overlap is under 2h but the candidate isn't scheduled-only", () => {
    const score = locationScore({
      ...BASE,
      tier: 4,
      timezoneOverlapHours: 1,
      candidateIsScheduledOnly: false,
    });
    expect(score).toBeCloseTo(0.4, 5);
  });

  it("does not apply the penalty when timezone overlap is 2h or more", () => {
    const score = locationScore({
      ...BASE,
      tier: 4,
      timezoneOverlapHours: 2,
      candidateIsScheduledOnly: true,
    });
    expect(score).toBeCloseTo(0.4, 5);
  });

  it("does not apply the penalty when timezoneOverlapHours is omitted", () => {
    const score = locationScore({ ...BASE, tier: 4, candidateIsScheduledOnly: true });
    expect(score).toBeCloseTo(0.4, 5);
  });
});
