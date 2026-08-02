import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

function requireDatabaseUrl(databaseUrl?: string): string {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

/** Pooled client for the running API — many reused connections. */
export function createPooledClient(databaseUrl?: string) {
  const queryClient = postgres(requireDatabaseUrl(databaseUrl), { max: 10 });
  return drizzle(queryClient, { schema });
}

/**
 * Single connection for migrations — DDL must run sequentially on one
 * connection; pooling migrations can deadlock or race across connections.
 */
export function createMigrationClient(databaseUrl?: string) {
  const migrationClient = postgres(requireDatabaseUrl(databaseUrl), { max: 1 });
  return drizzle(migrationClient, { schema });
}

export type Database = ReturnType<typeof createPooledClient>;

/**
 * Used by apps/api's /health/ready probe (PRD §17.9 #67, §21). Never
 * throws — a connectivity failure is a "not ready" signal, not an
 * exception the caller needs to catch.
 */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
