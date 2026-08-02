import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import postgres from "postgres";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const dockerContextDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "docker",
  "postgres",
);

function readMigration(name: string): string {
  return readFileSync(join(migrationsDir, name), "utf8");
}

const upMigrations = [
  "0000_identity.sql",
  "0001_profile_geo.sql",
  "0002_intents_availability_messaging.sql",
  "0003_matching_safety_billing_audit.sql",
].map(readMigration);
const downMigrations = [
  "0003_matching_safety_billing_audit.down.sql",
  "0002_intents_availability_messaging.down.sql",
  "0001_profile_geo.down.sql",
  "0000_identity.down.sql",
].map(readMigration);

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

// PRD §16.3-16.4, tested per the P2.4 prompt spec: the application role's
// UPDATE on audit_logs is rejected, and REFRESH MATERIALIZED VIEW
// CONCURRENTLY works. Skips gracefully where Docker isn't available (see
// identity.integration.test.ts).
describe.skipIf(!dockerAvailable)(
  "matching/safety/billing/audit migration (Testcontainers)",
  () => {
    let container: StartedTestContainer;
    let adminSql: ReturnType<typeof postgres>;
    let appSql: ReturnType<typeof postgres>;

    beforeAll(async () => {
      container = await GenericContainer.fromDockerfile(dockerContextDir)
        .build()
        .then((image) =>
          image
            .withEnvironment({
              POSTGRES_USER: "convene",
              POSTGRES_PASSWORD: "convene",
              POSTGRES_DB: "convene",
            })
            .withExposedPorts(5432)
            .start(),
        );

      const host = container.getHost();
      const port = container.getMappedPort(5432);
      adminSql = postgres(`postgres://convene:convene@${host}:${port}/convene`, { max: 1 });

      for (const migration of upMigrations) {
        await adminSql.unsafe(migration);
      }

      appSql = postgres(`postgres://convene_app:convene_app_dev_only@${host}:${port}/convene`, {
        max: 1,
      });
    }, 120_000);

    afterAll(async () => {
      await appSql?.end();
      await adminSql?.end();
      await container?.stop();
    });

    it("lets convene_app insert into audit_logs", async () => {
      await expect(
        appSql`
        INSERT INTO audit_logs (actor_type, action, entity_type)
        VALUES ('system', 'test.inserted', 'test')
      `,
      ).resolves.toBeDefined();
    });

    it("rejects convene_app's UPDATE on audit_logs", async () => {
      await expect(
        appSql`UPDATE audit_logs SET reason = 'tampered' WHERE entity_type = 'test'`,
      ).rejects.toThrow(/permission denied/);
    });

    it("rejects convene_app's DELETE on audit_logs", async () => {
      await expect(appSql`DELETE FROM audit_logs WHERE entity_type = 'test'`).rejects.toThrow(
        /permission denied/,
      );
    });

    it("lets convene_app UPDATE a normal table (proves the restriction is audit_logs-specific)", async () => {
      const [user] = await adminSql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES ('grant-check@example.com', 'Grant Check', '1990-01-01', 'v1')
      RETURNING id
    `;

      await expect(
        appSql`UPDATE users SET full_name = 'Updated' WHERE id = ${user!.id}`,
      ).resolves.toBeDefined();
    });

    it("refreshes mutual_connection_counts CONCURRENTLY", async () => {
      await expect(
        adminSql`REFRESH MATERIALIZED VIEW CONCURRENTLY mutual_connection_counts`,
      ).resolves.toBeDefined();
    });

    it("migrates down cleanly", async () => {
      await appSql.end();
      for (const migration of downMigrations) {
        await adminSql.unsafe(migration);
      }

      const tables = await adminSql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('match_candidates', 'reports', 'subscriptions', 'audit_logs', 'users')
    `;
      expect(tables).toHaveLength(0);

      const roles = await adminSql<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname = 'convene_app'
    `;
      expect(roles).toHaveLength(0);
    });
  },
);

if (!dockerAvailable) {
  console.warn(
    "matching-safety-billing-audit.integration.test.ts: Docker not available, skipping Testcontainers suite.",
  );
}
