import { Controller, Get, INestApplication, Module, Post } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EtagInterceptor } from "./etag.interceptor";
import {
  IdempotencyInterceptor,
  IdempotencyStore,
  InMemoryIdempotencyStore,
} from "./idempotency.interceptor";
import { RequestContextInterceptor } from "./request-context.interceptor";

let callCount = 0;

@Controller("test")
class TestController {
  @Get("echo")
  echo() {
    return { hello: "world" };
  }

  @Post("create")
  create() {
    callCount += 1;
    return { created: true, callCount };
  }
}

@Module({
  controllers: [TestController],
  providers: [
    { provide: IdempotencyStore, useClass: InMemoryIdempotencyStore },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EtagInterceptor },
  ],
})
class TestModule {}

describe("RequestContextInterceptor / EtagInterceptor / IdempotencyInterceptor", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sets X-Request-Id when the client doesn't supply one", async () => {
    const response = await request(app.getHttpServer()).get("/test/echo");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("echoes back a client-supplied X-Request-Id instead of generating a new one", async () => {
    const response = await request(app.getHttpServer())
      .get("/test/echo")
      .set("X-Request-Id", "client-supplied-id");
    expect(response.headers["x-request-id"]).toBe("client-supplied-id");
  });

  it("sets a content-hash ETag on the response", async () => {
    const first = await request(app.getHttpServer()).get("/test/echo");
    const second = await request(app.getHttpServer()).get("/test/echo");
    expect(first.headers.etag).toBeTruthy();
    // Same body content -> same ETag, deterministically.
    expect(first.headers.etag).toBe(second.headers.etag);
  });

  it("replays a stored response for a repeated Idempotency-Key instead of re-running the handler", async () => {
    callCount = 0;
    const key = "test-idempotency-key-1";

    const first = await request(app.getHttpServer())
      .post("/test/create")
      .set("Idempotency-Key", key);
    const second = await request(app.getHttpServer())
      .post("/test/create")
      .set("Idempotency-Key", key);

    expect(first.body).toEqual({ created: true, callCount: 1 });
    // Replayed response, not a fresh call — callCount must still read 1.
    expect(second.body).toEqual({ created: true, callCount: 1 });
  });

  it("runs the handler again for a different Idempotency-Key", async () => {
    callCount = 0;

    const first = await request(app.getHttpServer())
      .post("/test/create")
      .set("Idempotency-Key", "key-a");
    const second = await request(app.getHttpServer())
      .post("/test/create")
      .set("Idempotency-Key", "key-b");

    expect(first.body).toEqual({ created: true, callCount: 1 });
    expect(second.body).toEqual({ created: true, callCount: 2 });
  });

  it("runs the handler again when no Idempotency-Key is supplied at all", async () => {
    callCount = 0;

    const first = await request(app.getHttpServer()).post("/test/create");
    const second = await request(app.getHttpServer()).post("/test/create");

    expect(first.body).toEqual({ created: true, callCount: 1 });
    expect(second.body).toEqual({ created: true, callCount: 2 });
  });
});
