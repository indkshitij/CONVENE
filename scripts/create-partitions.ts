#!/usr/bin/env node
// Provisions monthly partitions for `messages` (PRD §10.7.7: "PARTITION
// BY RANGE (created_at) ... monthly partitions created 3 months ahead by
// a scheduled job") and, since P18.3, for `audit_logs` (§20.8: "monthly
// partitions"). Idempotent — safe to run repeatedly (e.g. from a
// monthly cron); only creates partitions that don't already exist.
//
// audit_logs has one extra step messages doesn't: migrations/0003's
// `ALTER DEFAULT PRIVILEGES ... GRANT UPDATE, DELETE ON TABLES TO
// convene_app` applies schema-wide, so a brand-new monthly partition
// table inherits UPDATE/DELETE grants by default the moment it's
// created — the REVOKE that keeps `audit_logs` itself append-only
// (migrations/0003's own `REVOKE UPDATE, DELETE ON audit_logs FROM
// convene_app`) does NOT automatically extend to a table that didn't
// exist yet when that REVOKE ran. Every new audit_logs partition needs
// its own REVOKE, or it would silently reopen the append-only guarantee
// this whole phase is about.
import "dotenv/config";
import postgres from "postgres";

const MONTHS_AHEAD = 3;

function monthRange(
  prefix: string,
  monthsFromNow: number,
): { name: string; from: string; to: string } {
  const start = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + monthsFromNow, 1),
  );
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const name = `${prefix}_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    name,
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    // Current month plus MONTHS_AHEAD more, so there's always at least
    // MONTHS_AHEAD full months of runway whenever this job runs.
    for (let i = 0; i <= MONTHS_AHEAD; i++) {
      const { name, from, to } = monthRange("messages", i);
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF messages FOR VALUES FROM ('${from}') TO ('${to}')`,
      );
      console.log(`ensured ${name} (${from} to ${to})`);
    }

    for (let i = 0; i <= MONTHS_AHEAD; i++) {
      const { name, from, to } = monthRange("audit_logs", i);
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF audit_logs FOR VALUES FROM ('${from}') TO ('${to}')`,
      );
      // Guarded with a role-existence check rather than a bare REVOKE —
      // a managed-Postgres deployment that authenticates the app role by
      // some other mechanism than a literal `convene_app` role name
      // shouldn't make this script fail outright.
      await sql.unsafe(`
        DO $$
        BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'convene_app') THEN
            EXECUTE 'REVOKE UPDATE, DELETE ON ${name} FROM convene_app';
          END IF;
        END
        $$;
      `);
      console.log(`ensured ${name} (${from} to ${to}), append-only`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
