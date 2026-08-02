import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

// PostgresService/RedisService come from @Global modules (PostgresModule,
// RedisModule in app.module.ts) — no explicit imports needed here.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
