import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooManyRequestsAppError } from "../errors/app-error";
import { RATE_LIMIT_POLICIES, type RateLimitKeyDimension, type RateLimitScope } from "./policies";
import { RateLimit } from "./rate-limit.decorator";

const mockEvalSlidingWindow = vi.fn();

// vi.mock calls are hoisted above all imports by vitest's transform, so
// this takes effect before the static import of RateLimitGuard below (which
// transitively imports "./sliding-window") even though it's written first
// here for readability.
vi.mock("./sliding-window", () => ({
  evalSlidingWindow: (...args: unknown[]) => mockEvalSlidingWindow(...args),
}));

import { RateLimitGuard } from "./rate-limit.guard";

interface FakeRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  userId?: string;
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}

function fakeRequestFor(dimensions: readonly RateLimitKeyDimension[]): FakeRequest {
  const request: FakeRequest = { headers: {} };
  for (const dimension of dimensions) {
    if (dimension === "ip") request.ip = "203.0.113.5";
    if (dimension === "user") request.userId = "user-1";
    if (dimension === "identifier") request.body = { identifier: "person@example.com" };
    if (dimension === "conversation") request.params = { conversationId: "conv-1" };
  }
  return request;
}

function fakeContext(
  handler: () => void,
  request: FakeRequest,
  headers: Map<string, string>,
): ExecutionContext {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader: (name: string, value: string) => headers.set(name, value),
      }),
    }),
  } as unknown as ExecutionContext;
}

function decoratedHandler(scope: RateLimitScope): () => void {
  const handler = (): void => undefined;
  RateLimit({ scope })(handler, "handler", { value: handler });
  return handler;
}

// P3.4 acceptance: "Table-driven tests over every policy row."
describe("RateLimitGuard", () => {
  let guard: InstanceType<typeof RateLimitGuard>;

  beforeEach(() => {
    mockEvalSlidingWindow.mockReset();
    guard = new RateLimitGuard(new Reflector(), { client: {} } as never);
  });

  it("allows a request when there is no @RateLimit metadata on the handler", async () => {
    const undecorated = (): void => undefined;
    const context = fakeContext(undecorated, { headers: {} }, new Map());
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockEvalSlidingWindow).not.toHaveBeenCalled();
  });

  for (const [scope, policy] of Object.entries(RATE_LIMIT_POLICIES)) {
    describe(`policy: ${scope}`, () => {
      it("allows the request and sets X-RateLimit-* headers when under the limit", async () => {
        mockEvalSlidingWindow.mockResolvedValue({ allowed: true, count: 1 });
        const headers = new Map<string, string>();
        const context = fakeContext(
          decoratedHandler(scope as RateLimitScope),
          fakeRequestFor(policy.keyDimensions),
          headers,
        );

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(headers.get("X-RateLimit-Limit")).toBe(String(policy.limit));
        expect(headers.get("X-RateLimit-Remaining")).toBe(String(policy.limit - 1));
        expect(headers.get("X-RateLimit-Reset")).toBeDefined();
      });

      it("throws 429 with Retry-After when the policy is exceeded", async () => {
        mockEvalSlidingWindow.mockResolvedValue({ allowed: false, count: policy.limit });
        const headers = new Map<string, string>();
        const context = fakeContext(
          decoratedHandler(scope as RateLimitScope),
          fakeRequestFor(policy.keyDimensions),
          headers,
        );

        await expect(guard.canActivate(context)).rejects.toThrow(TooManyRequestsAppError);
        expect(headers.get("Retry-After")).toBe(String(policy.windowSeconds));
      });
    });
  }

  // PRD §21.9 / P3.4 acceptance: "a test asserting behaviour degrades
  // safely with Redis down."
  describe("Redis unavailable", () => {
    it("falls back to a conservative in-process limit instead of throwing or allowing unlimited requests", async () => {
      mockEvalSlidingWindow.mockRejectedValue(new Error("Redis connection closed"));
      const policy = RATE_LIMIT_POLICIES["messages-per-user"];
      const fallbackLimit = Math.floor(policy.limit / 4);
      const request = fakeRequestFor(policy.keyDimensions);
      const handler = decoratedHandler("messages-per-user");

      for (let i = 0; i < fallbackLimit; i++) {
        const headers = new Map<string, string>();
        await expect(guard.canActivate(fakeContext(handler, request, headers))).resolves.toBe(true);
      }

      const headers = new Map<string, string>();
      await expect(guard.canActivate(fakeContext(handler, request, headers))).rejects.toThrow(
        TooManyRequestsAppError,
      );
    });

    it("does not throw an unhandled error itself when Redis is down (it degrades, not crashes)", async () => {
      mockEvalSlidingWindow.mockRejectedValue(new Error("ECONNREFUSED"));
      const policy = RATE_LIMIT_POLICIES.reports;
      const headers = new Map<string, string>();
      const context = fakeContext(
        decoratedHandler("reports"),
        fakeRequestFor(policy.keyDimensions),
        headers,
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe("missing key-dimension data", () => {
    it("throws a clear developer error when a user-scoped policy runs on a request with no userId", async () => {
      mockEvalSlidingWindow.mockResolvedValue({ allowed: true, count: 1 });
      const context = fakeContext(decoratedHandler("reports"), { headers: {} }, new Map());
      await expect(guard.canActivate(context)).rejects.toThrow(/userId/);
    });
  });
});
