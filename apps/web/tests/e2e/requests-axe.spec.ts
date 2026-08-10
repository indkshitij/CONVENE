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

test("/requests is axe clean with a populated Received tab", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    requests: [
      {
        id: "req-1",
        direction: "received",
        status: "pending",
        counterpartyId: "candidate-1",
        matchScore: 82,
        matchReasons: ["Complementary intents"],
      },
    ],
    requestsThrottle: { enabled: true, daily_cap: 5, queued_count: 1 },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/requests");
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("/requests is axe clean when empty", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ requests: [] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/requests");
  await expect(page.getByText("No requests yet")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
