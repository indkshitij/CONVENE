import { Module } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { HealthController } from "./health.controller";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { RedisService } from "../../infra/redis/redis.service";

function fakeService(pingResult: boolean): { ping: () => Promise<boolean> } {
  return { ping: () => Promise.resolve(pingResult) };
}

async function buildApp(postgresUp: boolean, redisUp: boolean): Promise<INestApplication> {
  @Module({
    controllers: [HealthController],
    providers: [
      { provide: PostgresService, useValue: fakeService(postgresUp) },
      { provide: RedisService, useValue: fakeService(redisUp) },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

// PRD §17.9 #67 / §21.4 acceptance: "stop Redis in a test and assert
// /health/ready returns 503 while /health still returns 200."
describe("HealthController", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("GET /health is 200 even when both dependencies are down (liveness has no dependency checks)", async () => {
    app = await buildApp(false, false);
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("GET /health/ready is 200 when Postgres and Redis are both up", async () => {
    app = await buildApp(true, true);
    const response = await request(app.getHttpServer()).get("/health/ready");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", checks: { postgres: "ok", redis: "ok" } });
  });

  it("GET /health/ready is 503 when Redis is down, while /health stays 200", async () => {
    app = await buildApp(true, false);

    const ready = await request(app.getHttpServer()).get("/health/ready");
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: "degraded", checks: { postgres: "ok", redis: "down" } });

    const health = await request(app.getHttpServer()).get("/health");
    expect(health.status).toBe(200);
  });

  it("GET /health/ready is 503 when Postgres is down", async () => {
    app = await buildApp(false, true);
    const response = await request(app.getHttpServer()).get("/health/ready");
    expect(response.status).toBe(503);
    expect(response.body.checks).toEqual({ postgres: "down", redis: "ok" });
  });

  it("GET /metrics returns Prometheus-format text", async () => {
    app = await buildApp(true, true);
    const response = await request(app.getHttpServer()).get("/metrics");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/plain/);
    expect(response.text).toContain("# HELP");
  });
});
