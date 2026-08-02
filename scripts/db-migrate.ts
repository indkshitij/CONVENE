#!/usr/bin/env node
// Applies every not-yet-applied migration in packages/db/migrations, in
// filename order, tracked in a _migrations bookkeeping table so re-running
// is idempotent. Migrations run on a single (unpooled) connection.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import postgres from "postgres";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "db",
  "migrations",
);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const appliedRows = await sql`SELECT name FROM _migrations`;
    const applied = new Set(appliedRows.map((row) => row.name as string));

    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }
      const contents = readFileSync(join(migrationsDir, file), "utf8");
      console.log(`apply ${file}`);
      await sql.unsafe(contents);
      await sql`INSERT INTO _migrations (name) VALUES (${file})`;
    }

    console.log("Migrations up to date.");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
