#!/usr/bin/env node
// Rolls back the single most recently applied migration by running its
// corresponding <name>.down.sql and removing it from _migrations.
import { readFileSync } from "node:fs";
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
    const [last] = await sql`SELECT name FROM _migrations ORDER BY id DESC LIMIT 1`;

    if (!last) {
      console.log("No migrations to roll back.");
      return;
    }

    const upName = last.name as string;
    const downFile = upName.replace(/\.sql$/, ".down.sql");
    const contents = readFileSync(join(migrationsDir, downFile), "utf8");

    console.log(`rollback ${downFile}`);
    await sql.unsafe(contents);
    await sql`DELETE FROM _migrations WHERE name = ${upName}`;

    console.log("Rolled back.");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
