import { defineConfig, devices } from "@playwright/test";

const MOCK_API_PORT = 3101;

// PRD §18.1's own testing bar for P19.1: unauthenticated (app) access
// redirects to login, a mid-onboarding user is bounced to their current
// step, and every authenticated route carries noindex. Those don't need a
// live apps/api — the guard only inspects httpOnly cookies this suite sets
// directly via `context.addCookies()`, never a real login. P20.2's wizard
// guard is different: it calls apps/api server-side (GET /profiles/me) to
// compute the real current step (lib/onboarding/current-step.ts), which
// Playwright's browser-side page.route() interception can't stand in for —
// see tests/e2e/support/mock-api-server.mts for why a real (if tiny) HTTP
// server is started here instead, with the Next server's own API_BASE_URL
// pointed at it below.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  // `next dev`, not `next start` — avoids requiring a separate `next
  // build` step before every local/CI test run at the cost of a slower
  // first request; the guard behaviour under test doesn't depend on
  // production vs dev rendering.
  webServer: [
    {
      command: `node tests/e2e/support/run-mock-api-server.mts`,
      url: `http://127.0.0.1:${MOCK_API_PORT}/taxonomies/industries`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PORT: String(MOCK_API_PORT) },
    },
    {
      command: "npx next dev -p 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { API_BASE_URL: `http://127.0.0.1:${MOCK_API_PORT}` },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
