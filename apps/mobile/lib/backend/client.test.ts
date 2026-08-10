import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBaseUrl, ApiError, apiFetch } from "./client";

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as Response;
}

describe("apiBaseUrl", () => {
  it("falls back to localhost:8080 when EXPO_PUBLIC_API_BASE_URL is unset", () => {
    expect(apiBaseUrl()).toBe("http://localhost:8080");
  });
});

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches a Bearer token when accessToken is given", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      fakeResponse(200, { ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/profiles/me", { accessToken: "token-123" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  // The one thing this client does that apps/web's own apiFetch doesn't
  // need to: set a literal `Cookie` header by hand, since there's no
  // browser cookie jar on this platform and apps/api's POST /auth/refresh
  // only reads the refresh token off that header.
  it("attaches the refresh token as a literal Cookie header, mirroring the BFF's own server-to-server mechanism", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      fakeResponse(200, { ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/auth/refresh", { method: "POST", refreshTokenCookie: "refresh-abc" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Cookie).toBe("refresh_token=refresh-abc");
  });

  it("throws ApiError with the envelope's fields on a non-2xx response", async () => {
    const envelope = {
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Incorrect email or password.",
        field: null,
        details: null,
        request_id: "req-1",
        retry_after: null,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(401, envelope)),
    );

    await expect(apiFetch("/auth/login", { method: "POST" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    });
  });

  it("returns undefined for a 204 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(204, null)),
    );
    await expect(apiFetch("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});

describe("ApiError", () => {
  it("carries every envelope field", () => {
    const err = new ApiError(409, {
      error: {
        code: "CONFLICT",
        message: "x",
        field: "y",
        details: { a: 1 },
        request_id: "r1",
        retry_after: 5,
      },
    });
    expect(err).toMatchObject({
      code: "CONFLICT",
      status: 409,
      field: "y",
      details: { a: 1 },
      requestId: "r1",
      retryAfter: 5,
    });
  });
});
