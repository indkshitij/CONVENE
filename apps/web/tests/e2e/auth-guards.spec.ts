import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

// PRD §18.1 testing bar: "unauthenticated access to each (app) route
// redirects to login." (app)/layout.tsx's requireActiveSession() runs
// this check before any child route renders, so every route in the
// group inherits it — this asserts a representative sample, not every
// single one, since they all share the exact same guard.
const APP_ROUTES = [
  "/home",
  "/discover",
  "/chats",
  "/requests",
  "/profile/edit",
  "/search",
  "/notifications",
  "/premium",
];

test.describe("unauthenticated access to (app) routes", () => {
  for (const route of APP_ROUTES) {
    test(`${route} redirects to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    });
  }
});

test("unauthenticated access to /admin redirects to /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});

// PRD §18.1 testing bar: "a user mid-onboarding is redirected to their
// current step." Session cookies are set directly (httpOnly, so the
// test sets them via the browser context API rather than any client-
// side call) — no real backend login is needed to exercise the guard.
// The access token here has to be a real mock token (not an arbitrary
// string) because the guard's redirect target is computed live from a
// server-side GET /profiles/me against tests/e2e/support/mock-api-server.mts
// — see lib/onboarding/current-step.ts for why the cookie's own
// onboarding_step can no longer drive this.
test("a user mid-onboarding is redirected to their current step", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  await context.addCookies([
    {
      name: "access_token",
      value: mockToken({ headline: "Product engineer", job_title: "Engineer" }),
      url: origin,
      httpOnly: true,
    },
    {
      name: "session_user",
      value: JSON.stringify({
        id: "u1",
        full_name: "Test User",
        email: "test@example.com",
        email_verified: true,
        onboarding_step: 1,
        status: "pending_verification",
      }),
      url: origin,
      httpOnly: true,
    },
  ]);

  await page.goto("/home");
  await expect(page).toHaveURL(/\/setup\/3$/);
});

// A fully onboarded session should NOT be redirected to onboarding.
test("a fully onboarded user reaches the requested (app) route", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  await context.addCookies([
    { name: "access_token", value: "fake-access-token", url: origin, httpOnly: true },
    {
      name: "session_user",
      value: JSON.stringify({
        id: "u1",
        full_name: "Test User",
        email: "test@example.com",
        email_verified: true,
        onboarding_step: 6,
        status: "active",
      }),
      url: origin,
      httpOnly: true,
    },
  ]);

  await page.goto("/home");
  await expect(page).toHaveURL(/\/home$/);
});
