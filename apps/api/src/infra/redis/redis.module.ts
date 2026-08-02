import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";

// @Global so RedisService (and, transitively, anything built on it — the
// idempotency store today, rate limiting in P3.4) is available everywhere
// without every consuming module re-importing this one.
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
