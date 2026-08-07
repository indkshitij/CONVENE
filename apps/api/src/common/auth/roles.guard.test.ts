import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./auth-context";
import { RolesGuard } from "./roles.guard";

function makeContext(request: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  const reflector = { getAllAndOverride: vi.fn((key: string) => metadata[key]) };
  const executionContext = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { reflector: reflector as unknown as Reflector, executionContext };
}

function context(role: AuthContext["role"]): AuthContext {
  return {
    id: "user-1",
    role,
    plan: "free",
    status: "active",
    tokenVersion: 0,
    shadowLimited: false,
  };
}

describe("RolesGuard", () => {
  it("allows a @Public() route regardless of roles metadata", () => {
    const { reflector, executionContext } = makeContext(
      { authContext: context("user") },
      { "convene:public-route": true, "convene:roles": ["admin"] },
    );
    expect(new RolesGuard(reflector).canActivate(executionContext)).toBe(true);
  });

  it("allows any role when @Roles(...) is not declared", () => {
    const { reflector, executionContext } = makeContext({ authContext: context("user") });
    expect(new RolesGuard(reflector).canActivate(executionContext)).toBe(true);
  });

  it("allows a role that is in the declared list", () => {
    const { reflector, executionContext } = makeContext(
      { authContext: context("admin") },
      { "convene:roles": ["admin", "moderator"] },
    );
    expect(new RolesGuard(reflector).canActivate(executionContext)).toBe(true);
  });

  it("rejects a role that is not in the declared list", () => {
    const { reflector, executionContext } = makeContext(
      { authContext: context("user") },
      { "convene:roles": ["admin", "moderator"] },
    );
    expect(() => new RolesGuard(reflector).canActivate(executionContext)).toThrow();
  });

  it("rejects when there is no auth context at all", () => {
    const { reflector, executionContext } = makeContext({}, { "convene:roles": ["admin"] });
    expect(() => new RolesGuard(reflector).canActivate(executionContext)).toThrow();
  });
});
