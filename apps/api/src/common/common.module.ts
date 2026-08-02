import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ErrorFilter } from "./errors/error.filter";
import { EtagInterceptor } from "./interceptors/etag.interceptor";
import { IdempotencyInterceptor, IdempotencyStore } from "./interceptors/idempotency.interceptor";
import { MetricsInterceptor } from "./interceptors/metrics.interceptor";
import { RequestContextInterceptor } from "./interceptors/request-context.interceptor";
import { RateLimitGuard } from "./rate-limit/rate-limit.guard";
import { RedisIdempotencyStore } from "../infra/redis/redis-idempotency-store";

// PRD §17.3 request lifecycle, the pieces P3.2/P3.3/P3.4 own, registered as
// global Nest enhancers so every route gets them without per-controller
// wiring. Nest always runs guards before interceptors, so RateLimitGuard
// executes before RequestContextInterceptor has assigned a requestId — a
// 429 thrown by the guard therefore carries request_id: null in its error
// envelope, unlike every other error path. Fixing that would mean moving
// request-id assignment out of an interceptor and into raw middleware
// (registered even earlier than guards), which is a larger change than
// this phase's scope; flagged here rather than silently left unexplained.
//
// Interceptor order matches declaration order: request-context runs
// outermost (sets requestId before anything else needs it), idempotency
// next (can short-circuit before the handler runs at all), etag innermost
// (shapes the response the handler actually produced). ErrorFilter is a
// global catch-all regardless of registration position.
//
// IdempotencyStore is bound to RedisIdempotencyStore here (RedisModule is
// @Global, so RedisService is available without importing it) —
// InMemoryIdempotencyStore remains available for tests that don't want a
// Redis dependency (see common/interceptors/interceptors.test.ts).
@Module({
  providers: [
    { provide: IdempotencyStore, useClass: RedisIdempotencyStore },
    { provide: APP_FILTER, useClass: ErrorFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EtagInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class CommonModule {}
