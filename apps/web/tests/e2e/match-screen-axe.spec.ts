import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockToken, type MockIntent } from "./support/mock-api-server";

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

function activeIntent(type: string): MockIntent {
  return {
    id: `seed-${type}`,
    type,
    detail: null,
    metadata: {},
    is_primary: true,
    is_paused: false,
    status: "active",
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    renewed_count: 0,
    created_at: new Date().toISOString(),
  };
}

test("/match/:userId is axe clean browsing, with the breakdown expanded, and in the connect form", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
    intents: [activeIntent("coffee_chat")],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();

  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: /compatible/ }).click();
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("/match/:userId's exhausted empty state is axe clean", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You've seen everyone available" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
