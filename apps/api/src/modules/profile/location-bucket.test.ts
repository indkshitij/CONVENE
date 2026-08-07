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
});
