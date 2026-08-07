// For routes whose resource query is always scoped to the caller's own id
// (e.g. "list my sessions", "log out all my devices") — there is no other
// user's resource this route could reach, so there's nothing further to
// decide. Still declared explicitly via `@Policy(selfScoped)` rather than
// left bare, so the route-inventory check (§20.3) has a real annotation to
// find rather than an implicit exemption.
export function selfScoped(): boolean {
  return true;
}
