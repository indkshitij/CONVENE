import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

function authCookies(origin: string, accessToken: string) {
  return [
    { name: "access_token", value: accessToken, url: origin, httpOnly: true },
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
  ];
}

test("/home is axe clean with populated sections", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [{ id: "candidate-1", score: 71, reasons: ["Complementary intents"] }],
    availableNowCandidates: [{ id: "candidate-2", score: 68, reasons: [] }],
    pendingRequestSenderIds: ["sender-1"],
    currentSession: {
      id: "s1",
      state: "available_now",
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      duration_minutes: 30,
      extensions_used: 0,
      extensions_remaining: 3,
      note: null,
      session_intents: [],
    },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Top matches" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("/home is axe clean with all sections empty", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [],
    availableNowCandidates: [],
    pendingRequestSenderIds: [],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Top matches" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
