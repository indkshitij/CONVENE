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

test("/search is axe clean with results and the filter sheet open", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    searchResults: [
      {
        user_id: "candidate-1",
        full_name: "Meera Iyer",
        headline: "Director, Data Science",
        job_title: null,
        company_name: "Xenon Labs",
        verification_level: 2,
      },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/search");
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByText("🔒 Filter by skills is a Premium feature")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("/notifications is axe clean with populated Today/Earlier groups", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    notifications: [
      {
        id: "n1",
        category: "request_accepted",
        title: "Your connection request was accepted",
        body: null,
        data: { conversationId: "conv-1" },
        priority: "normal",
        read_at: null,
        created_at: new Date().toISOString(),
      },
      {
        id: "n2",
        category: "moderation_action",
        title: "Your message was removed",
        body: null,
        data: {},
        priority: "normal",
        read_at: new Date().toISOString(),
        created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/notifications");
  await expect(page.getByText("Your connection request was accepted")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("/settings is axe clean with the notifications matrix and inbound filters populated", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    blockedUsers: [{ blocked_id: "user-9", reason: null, created_at: new Date().toISOString() }],
    inboundFilters: {
      accepted_intents: ["coffee_chat"],
      min_experience_years: null,
      max_experience_years: null,
      industries: null,
      verified_only: true,
      max_inbound_per_day: 10,
    },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("/premium is axe clean with a specific paywall reason shown", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ dailyRequestsUsed: 8 });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/premium?reason=daily_request_limit&return_to=%2Fhome");
  await expect(page.getByText(/You've used/)).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
