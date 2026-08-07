import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./auth-context";
import { PolicyGuard } from "./policy.guard";

function makeContext(request: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  const reflector = { getAllAndOverride: vi.fn((key: string) => metadata[key]) };
  const executionContext = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { reflector: reflector as unknown as Reflector, executionContext };
}

const authContext: AuthContext = {
  id: "user-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

describe("PolicyGuard", () => {
  it("allows a @Public() route without requiring a policy", async () => {
    const { reflector, executionContext } = makeContext({}, { "convene:public-route": true });
    const guard = new PolicyGuard(reflector);
    expect(await guard.canActivate(executionContext)).toBe(true);
  });

  // §20.3: "a route without an explicit policy fails a CI check" — this is
  // the guard's own defence-in-depth failure mode for the same rule.
  it("fails closed when neither @Public() nor @Policy() is declared", async () => {
    const { reflector, executionContext } = makeContext({ authContext });
    const guard = new PolicyGuard(reflector);
    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("throws if the guard somehow runs before JwtAuthGuard attached a context", async () => {
    const policyFn = vi.fn().mockReturnValue(true);
    const { reflector, executionContext } = makeContext({}, { "convene:policy": policyFn });
    const guard = new PolicyGuard(reflector);
    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("allows the request when the declared policy returns true", async () => {
    const policyFn = vi.fn().mockReturnValue(true);
    const { reflector, executionContext } = makeContext(
      { authContext },
      { "convene:policy": policyFn },
    );
    const guard = new PolicyGuard(reflector);
    expect(await guard.canActivate(executionContext)).toBe(true);
    expect(policyFn).toHaveBeenCalledWith(authContext, { authContext });
  });

  it("denies the request when the declared policy returns false", async () => {
    const policyFn = vi.fn().mockReturnValue(false);
    const { reflector, executionContext } = makeContext(
      { authContext },
      { "convene:policy": policyFn },
    );
    const guard = new PolicyGuard(reflector);
    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
  });

  it("supports an async policy function", async () => {
    const policyFn = vi.fn().mockResolvedValue(true);
    const { reflector, executionContext } = makeContext(
      { authContext },
      { "convene:policy": policyFn },
    );
    const guard = new PolicyGuard(reflector);
    expect(await guard.canActivate(executionContext)).toBe(true);
  });
});
