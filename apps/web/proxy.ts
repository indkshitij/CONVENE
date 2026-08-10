import { NextResponse, type NextRequest } from "next/server";

// P29.2 (§20.1 T9 "XSS": "strict CSP with nonces" / §20.5 "Application
// Hardening"): before this file, apps/web set NO security headers at
// all — confirmed by grep, not assumed. `proxy.ts` (Next's current file
// convention — `middleware.ts` is deprecated in this version, per
// AGENTS.md's own warning that this isn't the Next.js prior training
// data knows) is the one place a per-request nonce can be generated and
// attached to the CSP header before a page renders; Next automatically
// applies the same nonce to every framework/page script it emits once
// it sees `'nonce-...'` in the CSP header on the request (see this
// file's own doc reference: content-security-policy.md's "How nonces
// work in Next.js").
//
// A nonce-based CSP forces every page onto dynamic rendering (Next
// can't inject a fresh nonce into a statically-generated shell) — an
// accepted, inherent cost of "no unsafe-inline", not a bug.
// lib/realtime/socket.ts connects the browser directly to apps/realtime
// (a different origin/port from apps/web itself — the BFF pattern
// doesn't apply to the WS transport, only to REST calls) — `connect-src`
// must allow that origin explicitly or CSP silently breaks every
// real-time feature (presence, live messages) the moment this header
// ships. Derived from the same env var socket.ts itself reads, so the
// two can never drift out of sync.
function realtimeConnectSrc(): string {
  const wsUrl = process.env.NEXT_PUBLIC_REALTIME_WS_URL ?? "ws://localhost:8081/socket";
  try {
    return new URL(wsUrl).origin;
  } catch {
    return "ws://localhost:8081";
  }
}

// Media (avatars, portfolio images) is served from a signed URL apps/api
// itself returns (media/storage-provider.ts's presignGet) — apps/api's
// own origin in dev (its LocalFilesystemStorageProvider), and whatever
// real CDN/R2 custom domain production is configured with. There's no
// way to know that domain from inside this repo (no R2 integration
// exists yet — see billing/media module comments for the same "no live
// provider in this dev environment" pattern elsewhere), so
// `NEXT_PUBLIC_MEDIA_ORIGIN` is the seam: unset in dev (falls back to
// the local API origin), and must be set to the real media domain
// before this CSP ships to an environment where media is actually on a
// separate CDN host — otherwise every avatar/portfolio image silently
// fails to load, not a subtle bug, a very visible one that surfaces
// immediately in any manual check.
function mediaImgSrc(): string {
  const explicit = process.env.NEXT_PUBLIC_MEDIA_ORIGIN;
  if (explicit) return explicit;
  // `API_BASE_URL` (not NEXT_PUBLIC_-prefixed) is safe to read here
  // specifically because proxy.ts is server-only code, same as
  // lib/api/client.ts's own use of it — this value never reaches the
  // browser directly, only the resulting CSP header string does.
  try {
    return new URL(process.env.API_BASE_URL ?? "http://localhost:8080").origin;
  } catch {
    return "http://localhost:8080";
  }
}

// P29.2 security review found §20.1 T10's "origin checks on the BFF
// routes" control genuinely missing (confirmed by grep, nothing existed
// anywhere in apps/web). A same-origin check was attempted here and
// pulled back out: it broke two real, previously-passing e2e flows
// (settings.spec.ts's PUT-persistence and account-deletion tests) in a
// way that wasn't safely debuggable in this pass — `request.nextUrl.origin`
// didn't match the browser's own `Origin` header under Playwright's dev
// setup for reasons not yet root-caused. Reverted rather than shipped
// half-verified; the existing SameSite=Lax cookie config
// (set-session-cookies.ts) remains the real, working CSRF defense for
// these routes in the meantime. Flagged as an open T10 finding, not
// silently dropped.
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // §20.5: "Strict CSP with per-request nonces and no unsafe-inline."
  // `'unsafe-eval'` is dev-only (React's own dev-mode error
  // reconstruction needs it — see the Next.js CSP doc's own "Good to
  // know" note); never present in production.
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'nonce-${nonce}';
    img-src 'self' blob: data: ${mediaImgSrc()};
    font-src 'self';
    connect-src 'self' ${realtimeConnectSrc()};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", cspHeader);
  // §20.5: "HSTS with includeSubDomains; preload." 2 years
  // (63072000s) — comfortably over the 1-year minimum the HSTS
  // preload list requires, and the value Chrome's own preload-list
  // submission tool recommends.
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  // §20.5's remaining named headers — same file, same section, added
  // alongside CSP/HSTS rather than deferred to a separate pass.
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  // §20.5: "denying camera/microphone except on the voice-note route."
  // No voice-note recording UI exists yet in apps/web (confirmed: no
  // MediaRecorder/getUserMedia call site anywhere in this app), so
  // there is no route to carve an exception for yet — denies both
  // outright, honestly matching what's actually built rather than
  // pre-emptively allowlisting a route that doesn't exist. `geolocation`
  // is deliberately NOT in this deny list — the onboarding location
  // step (location-form.tsx) is a real, live `navigator.geolocation`
  // call site; blocking it here would break that existing feature, and
  // §20.5 never names geolocation as something to deny (only §20.6's
  // "we never track location in the background" applies, which this
  // header doesn't touch either way).
  response.headers.set("Permissions-Policy", "camera=(), microphone=()");

  return response;
}

// §20.5 / this file's own CSP doc: proxy should skip prefetches and
// static assets that don't need these headers.
export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
