// P18.3: the app has never before needed to distinguish a Postgres
// privilege violation from any other DB error — every earlier phase's
// error handling assumes the app's own DB role can do whatever the
// query asks. audit_logs is the first table where that's deliberately
// false (migrations/0003 REVOKEs UPDATE/DELETE from convene_app), so
// this is the first place that distinction needs a name.
const POSTGRES_INSUFFICIENT_PRIVILEGE = "42501";

export function isPostgresPermissionDeniedError(error: unknown): boolean {
  const code = extractPostgresErrorCode(error);
  return code === POSTGRES_INSUFFICIENT_PRIVILEGE;
}

function extractPostgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  // drizzle-orm wraps the driver error in `DrizzleQueryError.cause`
  // (postgres.js's own PostgresError, which carries a `code` field
  // matching the server's SQLSTATE) — see notifications.repository.ts's
  // targetWhere debugging from an earlier phase for the same wrapping.
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") return causeCode;
  }
  return undefined;
}
