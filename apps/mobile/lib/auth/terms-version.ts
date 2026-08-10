// Mirrors apps/web/lib/auth/terms-version.ts's CURRENT_TERMS_VERSION —
// duplicated rather than shared because it's app-local UI wiring (each
// app's own signup form pins the version *it* currently submits), not
// business logic; module boundaries (packages must not import apps, apps
// must not import each other) block importing the web copy directly.
// Ideally this constant would live in a shared package instead of being
// hand-kept in sync across two apps — flagged as a gap for a future pass,
// not fixed here (out of P27.1's scope).
export const CURRENT_TERMS_VERSION = "2026-06-01";
