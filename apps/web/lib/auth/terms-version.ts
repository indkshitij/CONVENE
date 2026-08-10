// PRD's own example format for `accepted_terms_version` is a date string
// (docs/Convene-PRD-v1.0.md's register example: "2026-06-01") — there's
// no canonical constant anywhere in apps/api, so this is the one place
// apps/web pins "the terms version every signup path (email/phone form
// and OAuth callback alike) currently submits." Bump this — and only
// this — when Terms/Privacy copy changes.
export const CURRENT_TERMS_VERSION = "2026-06-01";
