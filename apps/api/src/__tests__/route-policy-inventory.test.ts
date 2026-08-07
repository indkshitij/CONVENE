import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { PUBLIC_ROUTE_METADATA_KEY } from "../common/auth/jwt.guard";
import { POLICY_METADATA_KEY } from "../common/auth/policy.guard";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import { PostgresService } from "../infra/postgres/postgres.service";
import { RedisService } from "../infra/redis/redis.service";
import { EmbeddingRefreshProducer } from "../modules/profile/embedding-refresh.producer";
import { EmbeddingRefreshWorker } from "../workers/embedding-refresh.worker";

const ORIGINAL_ENV = { ...process.env };

// PRD §20.3: "Deny by default ... a route without an explicit policy fails
// a CI check." This is that CI check: it boots the real module graph
// (so every controller actually registered in AppModule is discovered,
// not a hand-maintained list that can drift) and asserts every route
// handler carries either `@Public()` or `@Policy(...)` metadata.
// PostgresService/RedisService are overridden with inert stand-ins since
// this test only inspects route metadata — it never issues a request — so
// no real Postgres/Redis needs to be reachable. EmbeddingRefreshProducer/
// Worker (P7.4) are overridden too: both construct real BullMQ Queue/
// Worker instances in their constructors, which need a genuinely
// reachable Redis to initialize cleanly — same rationale, one level
// deeper in the dependency graph.
describe("route policy inventory (§20.3 CI check)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL =
      "postgres://convene:convene@localhost:5432/convene_route_inventory_test";
    process.env.REDIS_URL = "redis://localhost:6379/0";
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("every registered route declares @Public() or @Policy(...)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(PostgresService)
      .useValue({ ping: async () => true, onModuleDestroy: async () => undefined })
      .overrideProvider(RedisService)
      .useValue({
        client: { get: async () => null, set: async () => "OK", del: async () => 0 },
        ping: async () => true,
        onModuleInit: async () => undefined,
        onModuleDestroy: () => undefined,
      })
      .overrideProvider(BullmqConnectionService)
      .useValue({
        client: {},
        onModuleInit: async () => undefined,
        onModuleDestroy: () => undefined,
      })
      .overrideProvider(EmbeddingRefreshProducer)
      .useValue({ enqueueRefresh: async () => undefined, onModuleDestroy: async () => undefined })
      .overrideProvider(EmbeddingRefreshWorker)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: async () => undefined })
      .compile();

    const discoveryService = moduleRef.get(DiscoveryService);
    const metadataScanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);

    const missing: string[] = [];
    let routeCount = 0;

    for (const wrapper of discoveryService.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerName = instance.constructor.name;

      for (const methodName of metadataScanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== "function") continue;

        const path: string | undefined = Reflect.getMetadata(PATH_METADATA, handler);
        const method: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (path === undefined || method === undefined) continue; // not an HTTP route handler

        routeCount += 1;
        const isPublic = reflector.get<boolean | undefined>(PUBLIC_ROUTE_METADATA_KEY, handler);
        const hasPolicy = reflector.get(POLICY_METADATA_KEY, handler);
        if (!isPublic && !hasPolicy) {
          missing.push(`${controllerName}.${methodName}`);
        }
      }
    }

    // A sanity floor so this test can't pass vacuously if discovery ever
    // silently finds zero controllers (e.g. a future NestJS upgrade
    // changing the DiscoveryService's internals).
    expect(routeCount).toBeGreaterThan(0);
    expect(missing).toEqual([]);

    await moduleRef.close();
  });
});
