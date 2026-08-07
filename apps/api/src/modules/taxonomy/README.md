# Taxonomy module

Not one of the 13 modules in PRD §17.2's table — added by P6.1 as a
cross-cutting owner for shared reference data no domain module claims.

**Owns:** read access to `skills`, `industries`, `cities`, `languages`,
`interests` (the tables themselves are still defined in `packages/db`
alongside the domains that reference them — this module doesn't own the
schema, only the cached read/typeahead/resolution API over it).

**Publishes:** none.

**Consumes:** none.
