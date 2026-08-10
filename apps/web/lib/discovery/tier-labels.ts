// PRD §10.5.4's location tier scale (0-6). design.md §14.8's own example
// ("NEARBY (within 25 km) -> IN BENGALURU -> IN KARNATAKA -> ACROSS INDIA
// -> WORLDWIDE") names the viewer's specific city/state, which this
// client component doesn't have plumbed in (the discover feed's own
// response carries no such context, only a numeric tier per candidate) —
// generic tier labels stand in instead, a documented simplification, not
// a transcription of the exact wireframe strings.
export function tierLabel(tier: number): string {
  if (tier <= 1) return "Nearby";
  if (tier === 2) return "In your city";
  if (tier === 3) return "In your state";
  if (tier === 4) return "Across the country";
  return "Worldwide";
}
