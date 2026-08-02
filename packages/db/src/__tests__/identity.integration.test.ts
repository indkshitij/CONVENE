import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const upSql = readFileSync(join(migrationsDir, "0000_identity.sql"), "utf8");
const downSql = readFileSync(join(migrationsDir, "0000_identity.down.sql"), "utf8");

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

// PRD §16.3 IDENTITY, tested per the P2.1 prompt spec: migrate up, assert
// every constraint rejects the value it should, then migrate down cleanly.
// Requires a real Docker daemon (Testcontainers) — skips gracefully where
// one isn't available rather than failing `pnpm test` on a dev machine
// without Docker installed.
describe.skipIf(!dockerAvailable)("identity migration (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    sql = postgres(container.getConnectionUri(), { max: 1 });
    await sql.unsafe(upSql);
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  it("migrates up and accepts a valid user", async () => {
    const [row] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES ('valid@example.com', 'Ada Lovelace', '1990-01-01', 'v1')
      RETURNING id
    `;
    expect(row?.id).toBeDefined();
  });

  it("rejects a row with neither email nor phone (chk_contact)", async () => {
    await expect(
      sql`
        INSERT INTO users (full_name, date_of_birth, terms_version)
        VALUES ('No Contact', '1990-01-01', 'v1')
      `,
    ).rejects.toThrow(/chk_contact/);
  });

  it("rejects a 17-year-old date of birth (chk_adult)", async () => {
    const seventeenYearsAgo = new Date();
    seventeenYearsAgo.setFullYear(seventeenYearsAgo.getFullYear() - 17);
    const dob = seventeenYearsAgo.toISOString().slice(0, 10);

    await expect(
      sql`
        INSERT INTO users (email, full_name, date_of_birth, terms_version)
        VALUES ('minor@example.com', 'Too Young', ${dob}, 'v1')
      `,
    ).rejects.toThrow(/chk_adult/);
  });

  it("migrates down cleanly", async () => {
    await sql.unsafe(downSql);

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'auth_identities', 'refresh_tokens')
    `;
    expect(tables).toHaveLength(0);
  });
});

if (!dockerAvailable) {
  console.warn(
    "identity.integration.test.ts: Docker not available, skipping Testcontainers suite.",
  );
}
