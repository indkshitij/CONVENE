#!/usr/bin/env node
// Provisions monthly partitions for the `messages` table (PRD §10.7.7:
// "PARTITION BY RANGE (created_at) ... monthly partitions created 3 months
// ahead by a scheduled job"). Idempotent — safe to run repeatedly (e.g. from
// a monthly cron); only creates partitions that don't already exist.
import "dotenv/config";
import postgres from "postgres";

const MONTHS_AHEAD = 3;

function monthRange(monthsFromNow: number): { name: string; from: string; to: string } {
  const start = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + monthsFromNow, 1),
  );
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const name = `messages_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
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
      const { name, from, to } = monthRange(i);
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF messages FOR VALUES FROM ('${from}') TO ('${to}')`,
      );
      console.log(`ensured ${name} (${from} to ${to})`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
