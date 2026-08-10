import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockToken, type MockIntent } from "./support/mock-api-server";

// Explicit acceptance criterion (CLAUDE.md rule 9, same bar P20.1 already
// met): "axe clean." Steps 4-6 introduce this phase's only new
// interactive controls (toggle chips, a range slider, radio/checkbox
// groups), so they get their own scan rather than relying on P20.1's
// coverage of the auth screens.
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
        onboarding_step: 1,
        status: "pending_verification",
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
    detail: "Building something interesting",
    metadata: {},
    is_primary: true,
    is_paused: false,
    status: "active",
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    renewed_count: 0,
    created_at: new Date().toISOString(),
  };
}

test.describe("axe accessibility scan — onboarding steps 4-6", () => {
  test("/setup/4 (intents, including an expanded chip and a blocked one)", async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const accessToken = mockToken({
      headline: "Product engineer",
      job_title: "Engineer",
      industry: { id: 1, label: "Technology" },
    });
    await context.addCookies(authCookies(origin, accessToken));

    await page.goto("/setup/4");
    await page.getByRole("button", { name: "Coffee Chat", exact: true }).click();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("/setup/5 (location)", async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const accessToken = mockToken({
      headline: "Product engineer",
      job_title: "Engineer",
      industry: { id: 1, label: "Technology" },
      intents: [activeIntent("coffee_chat")],
    });
    await context.addCookies(authCookies(origin, accessToken));

    await page.goto("/setup/5");
    // Unlike the /setup/4 and /setup/6 tests, this one has no interaction
    // between goto() and analyze() to implicitly wait for hydration —
    // without an explicit wait, axe can occasionally scan the pre-hydration
    // HTML shell (a real race, not a real accessibility defect: the h1 is
    // in the actual rendered page, just not yet painted at scan time).
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("/setup/6 (go available, including the post-creation confirmation state)", async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const accessToken = mockToken({
      headline: "Product engineer",
      job_title: "Engineer",
      industry: { id: 1, label: "Technology" },
      intents: [activeIntent("coffee_chat")],
      location: {
        city: "Jabalpur",
        state: "Madhya Pradesh",
        country: "IN",
        timezone: "Asia/Kolkata",
        distance_bucket: null,
      },
    });
    await context.addCookies(authCookies(origin, accessToken));

    await page.goto("/setup/6");
    await page.getByRole("button", { name: "Go available for 30 min" }).click();
    await expect(page.getByText("Continue to Convene")).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
