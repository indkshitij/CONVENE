// PRD §10.5.2's distance-bucket table. Full location scoring (radius
// expansion, decay curves) is Phase 9's own domain — this is only the
// display-bucketing rule, needed here because the profile response
// contract (§10.2.9) includes `distance_bucket` and BR-LOC-02 requires
// distance to always be server-computed and bucketed, never raw.
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
