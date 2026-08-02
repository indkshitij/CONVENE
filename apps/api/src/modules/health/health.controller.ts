import { Controller, Get, Res } from "@nestjs/common";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { RedisService } from "../../infra/redis/redis.service";
import { metricsRegistry } from "../../infra/telemetry/metrics";

interface ResponseLike {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string): void;
}

// PRD §17.9 #67 / §21: three internal probe endpoints. /health is
// liveness — no dependency checks, so it stays 200 as long as the process
// itself is up. /health/ready checks Postgres + Redis and returns 503 if
// either is down (§21.9 treats Redis as disposable but still reports it
// here — degraded is still worth surfacing to the orchestrator).
@Controller()
export class HealthController {
  constructor(
    private readonly postgres: PostgresService,
    private readonly redis: RedisService,
  ) {}

  @Get("health")
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("health/ready")
  async readiness(@Res({ passthrough: true }) res: ResponseLike): Promise<Record<string, unknown>> {
    const [postgresUp, redisUp] = await Promise.all([this.postgres.ping(), this.redis.ping()]);
    const ready = postgresUp && redisUp;

    res.status(ready ? 200 : 503);
    return {
      status: ready ? "ok" : "degraded",
      checks: {
        postgres: postgresUp ? "ok" : "down",
        redis: redisUp ? "ok" : "down",
      },
    };
  }

  @Get("metrics")
  async metrics(@Res({ passthrough: true }) res: ResponseLike): Promise<string> {
    res.setHeader("Content-Type", metricsRegistry.contentType);
    return metricsRegistry.metrics();
  }
}
