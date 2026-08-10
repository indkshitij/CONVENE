import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bucketDistanceKm } from "./location-bucket";

describe("bucketDistanceKm", () => {
  it.each([
    [1, true, "Under 2 km away"],
    [4, true, "~5 km away"],
    [10, true, "~10 km away"],
    [30, true, "~25 km away"],
    [60, true, "~50 km away"],
    [150, true, "~100 km away"],
    [500, true, "Same region"],
    [800, true, "Same country"],
    [800, false, "International"],
  ] as const)("buckets %skm (sameCountry=%s) as %s", (km, sameCountry, expected) => {
    expect(bucketDistanceKm(km, sameCountry)).toBe(expected);
  });

  // P9.2's own testing requirement: "Property test: for any two points,
  // the bucket label never implies precision better than 2km." Encoded
  // as: every distance strictly under 2km — no matter how close to 0 —
  // collapses to the exact same label, so the label itself can never be
  // used to distinguish, say, "50m away" from "1.9km away." This is the
  // executable form of threat T3 (no sub-2km granularity anywhere).
  it("property: every distance in [0, 2) km produces the identical 'Under 2 km away' label", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1.9999, noNaN: true }),
        fc.boolean(),
        (km, sameCountry) => {
          expect(bucketDistanceKm(km, sameCountry)).toBe("Under 2 km away");
        },
      ),
    );
  });

  // General form: for ANY two distances that are both under 2km apart in
  // absolute terms doesn't apply here (bucketDistanceKm takes a single
  // already-computed distance) — the meaningful property instead is that
  // the output is always one of the eight fixed labels, never a raw
  // number, for arbitrary non-negative distances.
  it("property: the output is always one of the eight fixed labels, never a raw number", () => {
    const validLabels = new Set([
      "Under 2 km away",
      "~5 km away",
      "~10 km away",
      "~25 km away",
      "~50 km away",
      "~100 km away",
      "Same region",
      "Same country",
      "International",
    ]);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 20_000, noNaN: true }),
        fc.boolean(),
        (km, sameCountry) => {
          expect(validLabels.has(bucketDistanceKm(km, sameCountry))).toBe(true);
        },
      ),
    );
  });
});
