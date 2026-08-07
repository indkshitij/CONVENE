// For routes where the real authorization decision is inherently I/O-bound
// (visibility level, block status, relationship — all DB reads) and so
// can't be expressed as one of §20.3's pure policy functions. PolicyGuard
// only asserts "an authenticated caller may attempt this read"; the actual
// per-resource decision (e.g. ProfileService's private/blocked/visibility
// checks) is enforced inside the service itself, not here. Declared
// explicitly via `@Policy(anyAuthenticatedUser)` rather than left bare, so
// the route-inventory check (§20.3) still has a real annotation to find —
// the finer-grained check is auditable in the service that performs it.
export function anyAuthenticatedUser(): boolean {
  return true;
}
