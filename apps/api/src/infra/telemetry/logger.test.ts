import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, redact } from "./logger";

describe("redact", () => {
  it("masks a top-level password field", () => {
    const result = redact({ email: "a@b.com", password: "hunter2" }) as Record<string, unknown>;
    expect(result.email).toBe("a@b.com");
    expect(result.password).toBe("[REDACTED]");
  });

  it("masks known-sensitive fields nested inside objects and arrays", () => {
    const result = redact({
      users: [
        { name: "Ananya", accessToken: "eyJ..." },
        { name: "Meera", refresh_token: "abc" },
      ],
    }) as { users: Array<Record<string, unknown>> };

    expect(result.users[0]?.name).toBe("Ananya");
    expect(result.users[0]?.accessToken).toBe("[REDACTED]");
    expect(result.users[1]?.refresh_token).toBe("[REDACTED]");
  });

  it("is case-insensitive on field names", () => {
    const result = redact({ Authorization: "Bearer xyz" }) as Record<string, unknown>;
    expect(result.Authorization).toBe("[REDACTED]");
  });

  it("leaves non-sensitive fields untouched", () => {
    const result = redact({ headline: "Building things", years: 5 });
    expect(result).toEqual({ headline: "Building things", years: 5 });
  });
});

describe("createLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // PRD §21.4: "always carrying request_id and user_id."
  it("always emits request_id and user_id, even when not supplied", () => {
    const logger = createLogger("debug");
    logger.info("hello");

    const line = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line.request_id).toBeNull();
    expect(line.user_id).toBeNull();
    expect(line.message).toBe("hello");
  });

  it("carries through request_id/user_id when supplied", () => {
    const logger = createLogger("debug");
    logger.info("hello", { requestId: "req-1", userId: "user-1" });

    const line = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line.request_id).toBe("req-1");
    expect(line.user_id).toBe("user-1");
  });

  // PRD §21.4: "PII-redacted at the logger" — a log line containing a
  // password field must never leak the raw value.
  it("redacts a password field passed in the log context", () => {
    const logger = createLogger("debug");
    logger.info("login attempt", { requestId: "req-1", password: "hunter2" });

    const line = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(JSON.stringify(line)).not.toContain("hunter2");
    expect(line.password).toBe("[REDACTED]");
  });

  it("suppresses levels below the configured minimum", () => {
    const logger = createLogger("warn");
    logger.debug("should not appear");
    logger.info("should not appear either");
    expect(logSpy).not.toHaveBeenCalled();
  });
});
