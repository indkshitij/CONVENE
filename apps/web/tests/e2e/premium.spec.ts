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

// PRD §13 F11's five triggers — each must name its specific limit (never
// a generic "Upgrade to Premium") and offer a way back to the blocked
// action via `return_to`.
const TRIGGERS: { reason: string; expectedText: string | RegExp }[] = [
  {
    reason: "daily_request_limit",
    expectedText: /You've used .* requests today\. Premium gives you 30\./,
  },
  {
    reason: "intent_limit",
    expectedText: /You've reached your .*-intent limit on the free plan\. Premium gives you 8\./,
  },
  {
    reason: "who_viewed_me",
    expectedText: "See everyone who viewed your profile — free plan only shows the count.",
  },
  {
    reason: "session_duration",
    expectedText: "Sessions longer than 2 hours are a Premium feature.",
  },
  { reason: "skills", expectedText: "Filtering by skills is a Premium feature." },
];

for (const trigger of TRIGGERS) {
  test(`reason=${trigger.reason} names its specific limit, not generic upgrade copy`, async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const accessToken = mockToken({ dailyRequestsUsed: 8 });
    await context.addCookies(authCookies(origin, accessToken));

    await page.goto(`/premium?reason=${trigger.reason}&return_to=%2Fhome`);
    await expect(page.getByText(trigger.expectedText)).toBeVisible();
    await expect(page.getByText("Upgrade to Premium", { exact: true })).toHaveCount(0);
  });
}

test("return_to link takes the user back to the blocked action's own screen", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/premium?reason=daily_request_limit&return_to=%2Fhome");
  await expect(page.getByRole("link", { name: "Return to where you were" })).toHaveAttribute(
    "href",
    "/home",
  );
});

test("an unsafe return_to (protocol-relative) is not honoured", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/premium?reason=daily_request_limit&return_to=%2F%2Fevil.example.com");
  await expect(page.getByRole("link", { name: "Return to where you were" })).toHaveCount(0);
});

test("Start trial is honest about billing not being connected, not a fake success", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/premium?reason=daily_request_limit");
  await page.getByRole("button", { name: "Start 7-day free trial" }).click();
  await expect(page.getByText(/Billing isn't connected/)).toBeVisible();
});
