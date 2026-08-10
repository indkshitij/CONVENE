import { cookies } from "next/headers";

// PRD §18.1: "the refresh token lives only in an httpOnly cookie handled
// by BFF routes — it is never readable by client JS." All three cookies
// below are httpOnly for the same reason (the requirement is a floor,
// not a ceiling) — nothing in this session ever needs to be read by
// client-side JS; every authenticated fetch either happens server-side
// (Server Components, Route Handlers) or is proxied through a BFF route
// that attaches the access token itself.
export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";
export const SESSION_USER_COOKIE = "session_user";

// Mirrors apps/api's own UserResponse shape (auth.service.ts) — the BFF
// routes copy these fields verbatim out of AuthResult.user into this
// cookie rather than the client ever calling apps/api directly to learn
// who's logged in.
export interface SessionUser {
  id: string;
  full_name: string;
  email: string | null;
  email_verified: boolean;
  onboarding_step: number;
  status: string;
  role: string;
}

export interface Session {
  user: SessionUser;
  accessToken: string;
}

// Server-only (reads httpOnly cookies via next/headers) — never call this
// from a Client Component. Next.js 16: `cookies()` is async (see
// AGENTS.md and this file's own verification against
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md).
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const userRaw = store.get(SESSION_USER_COOKIE)?.value;
  if (!accessToken || !userRaw) return null;

  try {
    const user = JSON.parse(userRaw) as SessionUser;
    return { user, accessToken };
  } catch {
    // A corrupted/tampered cookie is treated as "no session" rather than
    // thrown — the caller's guard redirects to /login either way.
    return null;
  }
}

export async function hasRefreshToken(): Promise<boolean> {
  const store = await cookies();
  return Boolean(store.get(REFRESH_TOKEN_COOKIE)?.value);
}
