import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import postgres from "postgres";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
// Same image docker-compose uses (docker/postgres/Dockerfile) — postgis +
// pgvector on top of Postgres 16, so this test exercises the identical
// extension set CI and local dev both run against.
const dockerContextDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "docker",
  "postgres",
);

const identityUpSql = readFileSync(join(migrationsDir, "0000_identity.sql"), "utf8");
const identityDownSql = readFileSync(join(migrationsDir, "0000_identity.down.sql"), "utf8");
const profileGeoUpSql = readFileSync(join(migrationsDir, "0001_profile_geo.sql"), "utf8");
const profileGeoDownSql = readFileSync(join(migrationsDir, "0001_profile_geo.down.sql"), "utf8");

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

// PRD §16.3 PROFILE and GEOGRAPHY REFERENCE, tested per the P2.2 prompt spec:
// insert a profile with coordinates and assert ST_DWithin returns it; assert
// the HNSW index is used by an EXPLAIN on a vector query. Skips gracefully
// where Docker isn't available (see identity.integration.test.ts).
describe.skipIf(!dockerAvailable)("profile/geo migration (Testcontainers)", () => {
  let container: StartedTestContainer;
  let sql: ReturnType<typeof postgres>;

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

    const connectionUri = `postgres://convene:convene@${container.getHost()}:${container.getMappedPort(5432)}/convene`;
    sql = postgres(connectionUri, { max: 1 });

    await sql.unsafe(identityUpSql);
    await sql.unsafe(profileGeoUpSql);
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  it("inserts a profile with coordinates and finds it via ST_DWithin", async () => {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES ('geo@example.com', 'Grace Hopper', '1990-01-01', 'v1')
      RETURNING id
    `;

    // Bengaluru city centre.
    await sql`
      INSERT INTO profiles (user_id, headline, job_title, timezone, coordinates)
      VALUES (
        ${user!.id}, 'Building things', 'Engineer', 'Asia/Kolkata',
        ST_MakePoint(77.5946, 12.9716)::geography
      )
    `;

    // A point ~2km away — should be within a 25km radius search.
    const nearby = await sql`
      SELECT user_id FROM profiles
      WHERE ST_DWithin(coordinates, ST_MakePoint(77.6101, 12.9789)::geography, 25000)
    `;
    expect(nearby.map((row) => row.user_id)).toContain(user!.id);

    // A point ~2000km away (Delhi) should not be within 25km.
    const far = await sql`
      SELECT user_id FROM profiles
      WHERE ST_DWithin(coordinates, ST_MakePoint(77.1025, 28.7041)::geography, 25000)
    `;
    expect(far.map((row) => row.user_id)).not.toContain(user!.id);
  });

  it("uses the HNSW index for a nearest-neighbour vector query", async () => {
    const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES ('embed@example.com', 'Ada Lovelace', '1990-01-01', 'v1')
      RETURNING id
    `;

    const vector = `[${Array.from({ length: 1024 }, () => Math.random()).join(",")}]`;
    await sql`
      INSERT INTO profile_embeddings (user_id, embedding, source_hash, model)
      VALUES (${user!.id}, ${vector}, 'hash-1', 'test-model')
    `;

    const queryVector = `[${Array.from({ length: 1024 }, () => Math.random()).join(",")}]`;
    const plan = await sql.unsafe(
      `EXPLAIN SELECT user_id FROM profile_embeddings ORDER BY embedding <=> '${queryVector}' LIMIT 5`,
    );
    const planText = plan.map((row: Record<string, unknown>) => Object.values(row)[0]).join("\n");
    expect(planText).toContain("Index Scan");
    expect(planText.toLowerCase()).toContain("hnsw");
  });

  it("migrates down cleanly", async () => {
    await sql.unsafe(profileGeoDownSql);
    await sql.unsafe(identityDownSql);

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('profiles', 'profile_embeddings', 'skills', 'users')
    `;
    expect(tables).toHaveLength(0);
  });
});

if (!dockerAvailable) {
  console.warn(
    "profile-geo.integration.test.ts: Docker not available, skipping Testcontainers suite.",
  );
}
