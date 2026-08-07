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
