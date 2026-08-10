// Unlike apps/web (every apps/api call goes through a Server Component or
// BFF route — see that file's own note on why), mobile has no server tier
// of its own: this fetch wrapper talks to apps/api directly from the
// device. Mirrors apps/web/lib/api/client.ts's ApiError/envelope shape
// exactly (same §17.9 wire contract on both platforms), with one
// mechanism difference: `refreshTokenCookie` sets a literal `Cookie`
// header by hand (React Native's fetch, unlike a browser's, isn't
// forbidden from setting it) — the same server-to-server trick apps/web's
// own BFF uses when it proxies a refresh, reused here since apps/api's
// POST /auth/refresh only ever reads the refresh token off that header
// (auth.controller.ts's readCookie()), never a bearer token or body
// field, on either platform.
const DEFAULT_API_BASE_URL = "http://localhost:8080";

export function apiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    field: string | null;
    details: unknown;
    request_id: string | null;
    retry_after: number | null;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | null;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryAfter: number | null;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope.error.code;
    this.field = envelope.error.field;
    this.details = envelope.error.details;
    this.requestId = envelope.error.request_id;
    this.retryAfter = envelope.error.retry_after;
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string | null;
  refreshTokenCookie?: string | null;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.refreshTokenCookie
        ? { Cookie: `refresh_token=${options.refreshTokenCookie}` }
        : {}),
      ...options.headers,
    },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`${apiBaseUrl()}${path}`, init);

  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
    if (envelope?.error) throw new ApiError(response.status, envelope);
    throw new Error(`apps/api request failed: ${response.status} ${response.statusText}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Same contract as apiFetch, plus the raw response Headers — needed for
// GET /profiles/me's ETag / PATCH's If-Match (apps/api's optimistic
// concurrency), the one place this app needs a response header apiFetch
// itself doesn't expose. Mirrors apps/web/lib/api/client.ts's own
// apiFetchWithHeaders.
export async function apiFetchWithHeaders<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.refreshTokenCookie
        ? { Cookie: `refresh_token=${options.refreshTokenCookie}` }
        : {}),
      ...options.headers,
    },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`${apiBaseUrl()}${path}`, init);

  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
    if (envelope?.error) throw new ApiError(response.status, envelope);
    throw new Error(`apps/api request failed: ${response.status} ${response.statusText}`);
  }

  const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { data, headers: response.headers };
}
