import { describe, expect, it } from "vitest";
import { isPostgresPermissionDeniedError } from "./postgres-error.util";

describe("isPostgresPermissionDeniedError", () => {
  it("detects a direct SQLSTATE 42501 code", () => {
    expect(isPostgresPermissionDeniedError({ code: "42501" })).toBe(true);
  });

  it("detects a wrapped drizzle DrizzleQueryError-style cause", () => {
    expect(
      isPostgresPermissionDeniedError({
        message: "Failed query",
        cause: { code: "42501", message: "permission denied for table audit_logs" },
      }),
    ).toBe(true);
  });

  it("returns false for an unrelated error code", () => {
    expect(isPostgresPermissionDeniedError({ code: "23505" })).toBe(false);
    expect(isPostgresPermissionDeniedError({ cause: { code: "23505" } })).toBe(false);
  });

  it("returns false for non-object or empty errors", () => {
    expect(isPostgresPermissionDeniedError(null)).toBe(false);
    expect(isPostgresPermissionDeniedError(undefined)).toBe(false);
    expect(isPostgresPermissionDeniedError("plain string")).toBe(false);
    expect(isPostgresPermissionDeniedError(new Error("boom"))).toBe(false);
    expect(isPostgresPermissionDeniedError({})).toBe(false);
  });
});
