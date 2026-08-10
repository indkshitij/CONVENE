import type { NextResponse } from "next/server";
import type { AuthResult } from "@/lib/api/client";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_USER_COOKIE,
  type SessionUser,
} from "./session";

const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // Mirrors apps/api's own REFRESH_COOKIE_TTL_MS (auth.controller.ts).

// Every BFF auth route (login/register/otp-verify/refresh) that receives
// an AuthResult from apps/api calls this instead of forwarding the JSON
// body to the browser as-is — apps/api's own response includes
// `tokens.refresh_token` in the body (it sets its own cookie too, on its
// own origin, which the browser never talks to directly here), and that
// raw string must never reach client JS. This is the one place that
// invariant is enforced.
export function setSessionCookies(response: NextResponse, result: AuthResult): void {
  response.cookies.set({
    name: ACCESS_TOKEN_COOKIE,
    value: result.tokens.access_token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: result.tokens.expires_in,
  });
  response.cookies.set({
    name: REFRESH_TOKEN_COOKIE,
    value: result.tokens.refresh_token,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
  const sessionUser: SessionUser = {
    id: result.user.id,
    full_name: result.user.full_name,
    email: result.user.email,
    email_verified: result.user.email_verified,
    onboarding_step: result.user.onboarding_step,
    status: result.user.status,
    role: result.user.role,
  };
  response.cookies.set({
    name: SESSION_USER_COOKIE,
    value: JSON.stringify(sessionUser),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete({ name: REFRESH_TOKEN_COOKIE, path: "/api/auth" });
  response.cookies.delete(SESSION_USER_COOKIE);
}
