import { Controller, Get, INestApplication, Injectable, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundAppError, ValidationAppError } from "./app-error";
import { ErrorFilter } from "./error.filter";
import { RequestContextInterceptor } from "../interceptors/request-context.interceptor";

// Shaped like a real `postgres` driver error — a unique-constraint violation
// carries the offending SQL and column values in its message.
class FakePostgresError extends Error {
  readonly code = "23505";
  constructor() {
    super(
      'duplicate key value violates unique constraint "users_email_key"\n' +
        "DETAIL:  Key (email)=(test@example.com) already exists.\n" +
        "  at Socket.emit (node:events:508:28)\n" +
        "    at TCP.onStreamRead (node:internal/stream_base_commons:189:23)",
    );
  }
}

@Injectable()
class TestService {
  boom(): never {
    throw new FakePostgresError();
  }
}

@Controller("test")
class TestController {
  constructor(private readonly service: TestService) {}

  @Get("db-error")
  dbError() {
    this.service.boom();
  }

  @Get("app-error")
  appError() {
    throw new NotFoundAppError("NOT_FOUND", "The requested resource could not be found.");
  }

  @Get("validation-error")
  validationError() {
    throw new ValidationAppError("VALIDATION_FAILED", "The request could not be validated.", {
      field: "email",
      details: [{ path: "email", message: "Invalid email" }],
    });
  }
}

@Module({
  controllers: [TestController],
  providers: [
    TestService,
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
class TestModule {}

// PRD §17.9 acceptance: "a test that throws a raw Postgres error from a
// handler and asserts the response contains no SQL." Every error path must
// produce the identical envelope shape.
describe("ErrorFilter", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("never leaks SQL, stack traces, or ORM error text for an unhandled driver error", async () => {
    const response = await request(app.getHttpServer()).get("/test/db-error");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        field: null,
        details: null,
        request_id: expect.any(String),
        retry_after: null,
      },
    });

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("duplicate key");
    expect(serialized).not.toContain("users_email_key");
    expect(serialized).not.toContain("node_modules");
    expect(serialized).not.toContain("at Socket");
  });

  it("produces the exact envelope shape for an AppError", async () => {
    const response = await request(app.getHttpServer()).get("/test/app-error");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource could not be found.",
        field: null,
        details: null,
        request_id: expect.any(String),
        retry_after: null,
      },
    });
  });

  it("carries field/details through for a validation error", async () => {
    const response = await request(app.getHttpServer()).get("/test/validation-error");

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.field).toBe("email");
    expect(response.body.error.details).toEqual([{ path: "email", message: "Invalid email" }]);
  });

  it("propagates the same request_id set by RequestContextInterceptor", async () => {
    const response = await request(app.getHttpServer())
      .get("/test/app-error")
      .set("X-Request-Id", "fixed-request-id-123");

    expect(response.body.error.request_id).toBe("fixed-request-id-123");
    expect(response.headers["x-request-id"]).toBe("fixed-request-id-123");
  });

  it("every error path produces the identical envelope shape", async () => {
    const responses = await Promise.all([
      request(app.getHttpServer()).get("/test/db-error"),
      request(app.getHttpServer()).get("/test/app-error"),
      request(app.getHttpServer()).get("/test/validation-error"),
    ]);

    for (const response of responses) {
      expect(Object.keys(response.body)).toEqual(["error"]);
      expect(Object.keys(response.body.error).sort()).toEqual(
        ["code", "message", "field", "details", "request_id", "retry_after"].sort(),
      );
    }
  });
});
