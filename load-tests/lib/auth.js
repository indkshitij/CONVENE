// Shared setup helper for every scenario in this directory: registers a
// pool of fresh load-test users via the real POST /auth/register
// endpoint (rather than depending on packages/db/seeds/users.ts, whose
// generated population has no password hash set — it's meant for
// browsing/matching fixtures, not login-based load testing) and returns
// their access tokens.
import http from "k6/http";
import { check } from "k6";

export const API_BASE_URL = __ENV.API_BASE_URL || "http://localhost:8080";
export const REALTIME_WS_URL = __ENV.REALTIME_WS_URL || "ws://localhost:8081/socket";

// PRD §10.1.5's accepted_terms_version contract — any non-empty string
// is accepted by the real schema (packages/validation/src/auth.ts's
// registerSchema); this just needs to be present.
const TERMS_VERSION = "2026-06-01";

function adultDateOfBirth() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 25);
  return date.toISOString().slice(0, 10);
}

// Registers `count` fresh users, tagged with `runId` so concurrent runs
// (or reruns against a shared environment) never collide on email.
export function registerLoadTestUsers(count, runId) {
  const users = [];
  for (let i = 0; i < count; i++) {
    const email = `k6-loadtest-${runId}-${i}@example.invalid`;
    const password = "LoadTest!2026";
    const body = JSON.stringify({
      method: "email",
      email,
      password,
      full_name: `Load Test User ${i}`,
      date_of_birth: adultDateOfBirth(),
      accepted_terms_version: TERMS_VERSION,
    });
    const response = http.post(`${API_BASE_URL}/auth/register`, body, {
      headers: { "Content-Type": "application/json" },
    });
    const ok = check(response, {
      "register succeeded": (r) => r.status === 201 || r.status === 200,
    });
    if (!ok) continue;
    const parsed = JSON.parse(response.body);
    users.push({ userId: parsed.user.id, accessToken: parsed.tokens.access_token });
  }
  return users;
}

export function getWsTicket(accessToken) {
  const response = http.post(`${API_BASE_URL}/realtime/ticket`, null, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  check(response, { "ticket issued": (r) => r.status === 200 || r.status === 201 });
  return JSON.parse(response.body).ticket;
}
