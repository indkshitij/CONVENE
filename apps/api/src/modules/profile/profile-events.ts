// PRD §17.2 Profile module "Publishes: profile.updated" — consumed by
// Matching and Search (not built yet) and, as of P7.4, by this module's
// own embedding-refresh listener. changedFields uses the same snake_case
// names PATCH /profiles/me and the children-CRUD endpoints accept, so a
// listener can match against BR-PROF-09's literal field list
// (headline/about/skills/job_title) without a translation table.
export const PROFILE_UPDATED_EVENT = "profile.updated";

export interface ProfileUpdatedEvent {
  userId: string;
  changedFields: string[];
}

// PRD §17.2 Profile module "Publishes: ... profile.location_changed" (P9.1)
// — a distinct, more specific event than profile.updated since location
// changes (BR-LOC-11 timezone overlap, matching's location score) have
// their own invalidation needs (candidate re-generation by geo tier) that
// don't overlap with the embedding-refresh trigger fields.
export const PROFILE_LOCATION_CHANGED_EVENT = "profile.location_changed";

export interface ProfileLocationChangedEvent {
  userId: string;
}
