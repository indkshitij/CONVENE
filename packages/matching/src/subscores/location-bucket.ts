// PRD §10.5.2's distance-bucket table. BR-LOC-02: "Distance is computed
// server-side and returned as a bucket label" — this is the single,
// shared implementation of that bucketing rule (P9.2), used by both
// profile responses (§10.2.9's distance_bucket field) and match/feed
// cards. Living in packages/matching (not duplicated per-consumer) is
// itself part of the threat-T3 defence: there is exactly one place a
// distance-to-label decision can be made, so there is exactly one place
// to audit for sub-2km granularity.
//
// The finest bucket is "Under 2 km away" — the `km < 2` branch is the
// first and only check capable of returning it, and no other branch (or
// any other function anywhere) may introduce a finer cutoff. See
// location-bucket.test.ts's property test for the executable form of
// this invariant.
export function bucketDistanceKm(km: number, sameCountry: boolean): string {
  if (km < 2) return "Under 2 km away";
  if (km < 5) return "~5 km away";
  if (km < 15) return "~10 km away";
  if (km < 35) return "~25 km away";
  if (km < 75) return "~50 km away";
  if (km < 200) return "~100 km away";
  if (km < 600) return "Same region";
  return sameCountry ? "Same country" : "International";
}
