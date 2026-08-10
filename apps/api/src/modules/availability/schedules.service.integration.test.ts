import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@convene/db";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../common/clock";
import { AvailabilityRepository } from "./repositories/availability.repository";
import { SchedulesRepository } from "./repositories/schedules.repository";
import { IntentsService } from "../intents/intents.service";
import { ScheduleGeneratorService } from "./schedule-generator.service";
import { SchedulesService } from "./schedules.service";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

const migrationsDir = join(__dirname, "..", "..", "..", "..", "..", "packages", "db", "migrations");
const dockerContextDir = join(__dirname, "..", "..", "..", "..", "..", "docker", "postgres");

const MIGRATIONS = [
  "0000_identity",
  "0001_profile_geo",
  "0002_intents_availability_messaging",
  "0003_matching_safety_billing_audit",
  "0004_auth_session_security",
  "0005_refresh_sessions",
  "0006_password_reset_tokens",
  "0007_erasure_retention_fks",
  "0008_profile_search_and_name_change",
  "0009_verification_ladder",
  "0010_location_encryption",
  "0011_candidate_generation_indexes",
  "0012_schedule_intents",
];

// PRD §10.3.8 endpoint 22 / BR-AVAIL-09/10, run against a real Postgres
// (see otp.service.integration.test.ts for why).
describe.skipIf(!dockerAvailable)(
  "SchedulesService / ScheduleGeneratorService (Testcontainers)",
  () => {
    let container: StartedTestContainer;
    let sql: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    let schedulesRepository: SchedulesRepository;
    let availabilityRepository: AvailabilityRepository;
    let schedulesService: SchedulesService;
    let generatorService: ScheduleGeneratorService;
    let now: Date;
    const clock: Clock = { now: () => now };

    beforeAll(async () => {
      container = await GenericContainer.fromDockerfile(dockerContextDir)
        .build()
        .then((image) =>
          image.withExposedPorts(5432).withEnvironment({ POSTGRES_PASSWORD: "test" }).start(),
        );

      const port = container.getMappedPort(5432);
      const host = container.getHost();
      sql = postgres(`postgres://postgres:test@${host}:${port}/postgres`, { max: 10 });
      db = drizzle(sql, { schema });

      for (const migration of MIGRATIONS) {
        const upSql = readFileSync(join(migrationsDir, `${migration}.sql`), "utf8");
        await sql.unsafe(upSql);
      }
    }, 120_000);

    afterAll(async () => {
      await sql?.end();
      await container?.stop();
    });

    beforeEach(async () => {
      await sql`DELETE FROM availability_live`;
      await sql`DELETE FROM availability_sessions`;
      await sql`DELETE FROM availability_schedules`;
      await sql`DELETE FROM users`;

      now = new Date("2026-08-06T00:00:00Z"); // a Thursday
      const postgresService = { db } as never;
      schedulesRepository = new SchedulesRepository(postgresService);
      availabilityRepository = new AvailabilityRepository(postgresService);
      const intentsService = new IntentsService(postgresService, clock);
      schedulesService = new SchedulesService(
        postgresService,
        schedulesRepository,
        intentsService,
        clock,
      );
      generatorService = new ScheduleGeneratorService(
        postgresService,
        schedulesRepository,
        availabilityRepository,
        clock,
      );
    });

    async function createUser(lastActiveAt: Date | null): Promise<string> {
      const [user] = await sql`
      INSERT INTO users (email, full_name, date_of_birth, terms_version, last_active_at)
      VALUES (${"sched-test-" + Math.random().toString(36).slice(2) + "@example.com"}, 'Sched Test', '1990-01-01', 'v1', ${lastActiveAt?.toISOString() ?? null})
      RETURNING id
    `;
      const userId = (user as { id: string }).id;
      await sql`INSERT INTO profiles (user_id) VALUES (${userId})`;
      return userId;
    }

    it("creates a weekly schedule and returns the next occurrences", async () => {
      const userId = await createUser(now);
      const result = await schedulesService.createSchedule(userId, "free", {
        start_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(), // tomorrow (Friday)
        duration_minutes: 45,
        timezone: "Asia/Kolkata",
        recurrence: { freq: "WEEKLY", byday: ["FR"] },
      });

      expect(result.schedule.duration_minutes).toBe(45);
      expect(result.next_occurrences.length).toBeGreaterThan(0);
    });

    it("§10.3.7 'Overlap': rejects a new window that overlaps an existing one", async () => {
      const userId = await createUser(now);
      await schedulesService.createSchedule(userId, "free", {
        start_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
        duration_minutes: 60,
        timezone: "Asia/Kolkata",
        recurrence: { freq: "WEEKLY", byday: ["FR"] },
      });

      await expect(
        schedulesService.createSchedule(userId, "free", {
          start_at: new Date(now.getTime() + 24 * 60 * 60_000 + 30 * 60_000).toISOString(), // 30min later, same Friday
          duration_minutes: 60,
          timezone: "Asia/Kolkata",
          recurrence: { freq: "WEEKLY", byday: ["FR"] },
        }),
      ).rejects.toMatchObject({ code: "SCHEDULE_OVERLAP", httpStatus: 409 });
    });

    it("BR-AVAIL-09: free plan is capped at 3 active schedules", async () => {
      const userId = await createUser(now);
      for (let i = 0; i < 3; i++) {
        await schedulesService.createSchedule(userId, "free", {
          start_at: new Date(now.getTime() + (i + 1) * 24 * 60 * 60_000).toISOString(),
          duration_minutes: 30,
          timezone: "Asia/Kolkata",
        });
      }

      await expect(
        schedulesService.createSchedule(userId, "free", {
          start_at: new Date(now.getTime() + 10 * 24 * 60 * 60_000).toISOString(),
          duration_minutes: 30,
          timezone: "Asia/Kolkata",
        }),
      ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED", httpStatus: 402 });
    });

    it("BR-AVAIL-10: the generator creates a real session for a recently-active user when the occurrence is due", async () => {
      const userId = await createUser(now); // active right now
      await schedulesService.createSchedule(userId, "premium", {
        start_at: new Date(now.getTime() + 60_000).toISOString(), // due in 1 minute
        duration_minutes: 30,
        timezone: "Asia/Kolkata",
      });

      now = new Date(now.getTime() + 65_000); // 65s later — inside the occurrence's due window
      const result = await generatorService.generateDueSessions();
      expect(result.created).toBe(1);
      expect(result.skippedDormant).toBe(0);

      const [session] =
        await sql`SELECT state, source FROM availability_sessions WHERE user_id = ${userId} AND ended_at IS NULL`;
      expect((session as { state: string }).state).toBe("available_now");
      expect((session as { source: string }).source).toBe("schedule");
    });

    it("BR-AVAIL-10: a dormant user (inactive > 72h) does not get an auto-created session", async () => {
      const dormantSince = new Date(now.getTime() - 100 * 60 * 60 * 1000); // 100h ago
      const userId = await createUser(dormantSince);
      await schedulesService.createSchedule(userId, "premium", {
        start_at: new Date(now.getTime() + 60_000).toISOString(),
        duration_minutes: 30,
        timezone: "Asia/Kolkata",
      });

      now = new Date(now.getTime() + 65_000);
      const result = await generatorService.generateDueSessions();
      expect(result.created).toBe(0);
      expect(result.skippedDormant).toBe(1);

      const liveRows =
        await sql`SELECT * FROM availability_sessions WHERE user_id = ${userId} AND ended_at IS NULL`;
      expect(liveRows).toHaveLength(0);
    });

    it("updateSchedule and deleteSchedule are ownership-scoped", async () => {
      const userA = await createUser(now);
      const userB = await createUser(now);
      const created = await schedulesService.createSchedule(userA, "free", {
        start_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
        duration_minutes: 30,
        timezone: "Asia/Kolkata",
      });

      await expect(
        schedulesService.updateSchedule(userB, created.schedule.id, { duration_minutes: 60 }),
      ).rejects.toMatchObject({
        code: "SCHEDULE_NOT_FOUND",
        httpStatus: 404,
      });
      await expect(
        schedulesService.deleteSchedule(userB, created.schedule.id),
      ).rejects.toMatchObject({
        code: "SCHEDULE_NOT_FOUND",
        httpStatus: 404,
      });
    });
  },
);
