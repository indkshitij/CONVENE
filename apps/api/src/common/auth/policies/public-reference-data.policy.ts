// For routes that read shared, non-personal reference data (taxonomies:
// skills, industries, cities, languages, interests) — any authenticated
// user may read them regardless of role, and there is no per-resource
// owner to check. Declared explicitly via `@Policy(publicReferenceData)`
// rather than left bare, so the route-inventory check (§20.3) has a real
// annotation to find.
export function publicReferenceData(): boolean {
  return true;
}
