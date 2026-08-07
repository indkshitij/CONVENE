import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "./jwt.guard";
import type { AuthContext } from "./auth-context";

function makeContext(request: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => metadata[key]),
  };
  const executionContext = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { reflector: reflector as unknown as Reflector, executionContext };
}

describe("JwtAuthGuard", () => {
  it("allows a @Public() route without checking for a token", async () => {
    const { reflector, executionContext } = makeContext(
      { headers: {} },
      { "convene:public-route": true },
    );
    const tokenService = { verifyAccessToken: vi.fn() };
    const authContextService = { get: vi.fn() };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    expect(await guard.canActivate(executionContext)).toBe(true);
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header", async () => {
    const { reflector, executionContext } = makeContext({ headers: {} });
    const tokenService = { verifyAccessToken: vi.fn() };
    const authContextService = { get: vi.fn() };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a malformed access token", async () => {
    const { reflector, executionContext } = makeContext({
      headers: { authorization: "Bearer garbage" },
    });
    const tokenService = { verifyAccessToken: vi.fn().mockRejectedValue(new Error("bad token")) };
    const authContextService = { get: vi.fn() };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects when the token's tv claim doesn't match the current auth context", async () => {
    const request: Record<string, unknown> = { headers: { authorization: "Bearer valid" } };
    const { reflector, executionContext } = makeContext(request);
    const tokenService = { verifyAccessToken: vi.fn().mockResolvedValue({ sub: "user-1", tv: 0 }) };
    const authContext: AuthContext = {
      id: "user-1",
      role: "user",
      plan: "free",
      status: "active",
      tokenVersion: 1,
      shadowLimited: false,
    };
    const authContextService = { get: vi.fn().mockResolvedValue(authContext) };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a suspended account", async () => {
    const request: Record<string, unknown> = { headers: { authorization: "Bearer valid" } };
    const { reflector, executionContext } = makeContext(request);
    const tokenService = { verifyAccessToken: vi.fn().mockResolvedValue({ sub: "user-1", tv: 0 }) };
    const authContext: AuthContext = {
      id: "user-1",
      role: "user",
      plan: "free",
      status: "suspended",
      tokenVersion: 0,
      shadowLimited: false,
    };
    const authContextService = { get: vi.fn().mockResolvedValue(authContext) };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: "ACCOUNT_SUSPENDED",
    });
  });

  it("rejects a pending_verification account on a route without @OnboardingAllowed()", async () => {
    const request: Record<string, unknown> = { headers: { authorization: "Bearer valid" } };
    const { reflector, executionContext } = makeContext(request);
    const tokenService = { verifyAccessToken: vi.fn().mockResolvedValue({ sub: "user-1", tv: 0 }) };
    const authContext: AuthContext = {
      id: "user-1",
      role: "user",
      plan: "free",
      status: "pending_verification",
      tokenVersion: 0,
      shadowLimited: false,
    };
    const authContextService = { get: vi.fn().mockResolvedValue(authContext) };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: "VERIFICATION_REQUIRED",
    });
  });

  it("allows a pending_verification account on a route marked @OnboardingAllowed()", async () => {
    const request: Record<string, unknown> = { headers: { authorization: "Bearer valid" } };
    const { reflector, executionContext } = makeContext(request, {
      "convene:onboarding-allowed": true,
    });
    const tokenService = { verifyAccessToken: vi.fn().mockResolvedValue({ sub: "user-1", tv: 0 }) };
    const authContext: AuthContext = {
      id: "user-1",
      role: "user",
      plan: "free",
      status: "pending_verification",
      tokenVersion: 0,
      shadowLimited: false,
    };
    const authContextService = { get: vi.fn().mockResolvedValue(authContext) };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    expect(await guard.canActivate(executionContext)).toBe(true);
    expect(request.authContext).toBe(authContext);
  });

  it("allows an active user and attaches the auth context to the request", async () => {
    const request: Record<string, unknown> = { headers: { authorization: "Bearer valid" } };
    const { reflector, executionContext } = makeContext(request);
    const tokenService = { verifyAccessToken: vi.fn().mockResolvedValue({ sub: "user-1", tv: 2 }) };
    const authContext: AuthContext = {
      id: "user-1",
      role: "user",
      plan: "free",
      status: "active",
      tokenVersion: 2,
      shadowLimited: false,
    };
    const authContextService = { get: vi.fn().mockResolvedValue(authContext) };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    expect(await guard.canActivate(executionContext)).toBe(true);
    expect(request.authContext).toBe(authContext);
  });

  it("allows a shadow_limited user through (writes become no-ops elsewhere, not here)", async () => {
    const request: Record<string, unknown> = { headers: { authorization: "Bearer valid" } };
    const { reflector, executionContext } = makeContext(request);
    const tokenService = { verifyAccessToken: vi.fn().mockResolvedValue({ sub: "user-1", tv: 0 }) };
    const authContext: AuthContext = {
      id: "user-1",
      role: "user",
      plan: "free",
      status: "shadow_limited",
      tokenVersion: 0,
      shadowLimited: true,
    };
    const authContextService = { get: vi.fn().mockResolvedValue(authContext) };
    const guard = new JwtAuthGuard(reflector, tokenService as never, authContextService as never);

    expect(await guard.canActivate(executionContext)).toBe(true);
  });
});
