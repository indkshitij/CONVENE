import { defineConfig } from "drizzle-kit";

// Migrations are hand-written (see migrations/*.sql) to keep exact control
// over Postgres-specific DDL (partial indexes, CHECK constraints, the
// uuidv7() function) — this config is for drizzle-kit introspection/studio
// only, not `drizzle-kit generate`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://convene:convene@localhost:5432/convene",
  },
});
