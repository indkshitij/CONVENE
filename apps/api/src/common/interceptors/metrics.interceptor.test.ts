import { Controller, Get, INestApplication, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MetricsInterceptor } from "./metrics.interceptor";
import { metricsRegistry } from "../../infra/telemetry/metrics";

@Controller("test")
class TestController {
  @Get("ok")
  ok() {
    return { hello: "world" };
  }
}

@Module({
  controllers: [TestController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
class TestModule {}

// PRD §21.4: "/metrics (Prometheus, RED metrics per route)."
describe("MetricsInterceptor", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("records a request against the shared metrics registry", async () => {
    await request(app.getHttpServer()).get("/test/ok");

    const output = await metricsRegistry.metrics();
    expect(output).toContain("http_requests_total");
    expect(output).toContain('method="GET"');
    expect(output).toContain('status_code="200"');
  });
});
