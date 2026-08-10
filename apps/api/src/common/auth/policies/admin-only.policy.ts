// For routes whose real gate is a role check, not a per-resource decision
// — the actual restriction is `@Roles("admin")` (roles.guard.ts); this
// exists only so the route-inventory check (§20.3) has an explicit
// annotation to find, same precedent as selfScoped/anyAuthenticatedUser.
export function adminOnly(): boolean {
  return true;
}
