import { expect, test } from "@playwright/test";
import { mockToken, type MockIntent } from "./support/mock-api-server";

// P20.3's own acceptance line: "No fabricated numbers anywhere in
// onboarding." These three tests are the direct proof of that claim for
// steps 4-6 — see intents-form.tsx, location-form.tsx, and
// go-available-form.tsx's own comments for why each number shown is
// sourced from a real endpoint response (honestly zero where the real
// matching pipeline doesn't exist yet) rather than estimated client-side.
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

test("the live match counter reflects the real (mocked) match_preview, not a fabricated estimate", async ({
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
  await expect(page).toHaveURL(/\/setup\/4$/);

  // Before any selection: no number is shown at all, not even a "0" —
  // the UI must not imply a query has run when it hasn't.
  await expect(page.getByText("Select an intent to see potential matches")).toBeVisible();

  await page.getByRole("button", { name: "Coffee Chat", exact: false }).click();

  // apps/api's own createIntent response hardcodes match_preview to
  // {potential_matches: 0, nearby: 0} until the matching pipeline exists
  // (intents.service.ts's own comment) — the mock mirrors that exactly,
  // so the UI showing "0" here is proof it renders the real response
  // field, not a plausible-looking placeholder.
  await expect(page.getByText("✦ 0 potential matches")).toBeVisible();
});

test("exceeding the intent plan limit shows an upsell without deselecting anything already chosen", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    headline: "Product engineer",
    job_title: "Engineer",
    industry: { id: 1, label: "Technology" },
    planLimit: 1,
    intents: [activeIntent("coffee_chat")],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/setup/4");
  await page.getByRole("button", { name: "Need a Mentor", exact: false }).click();

  await expect(
    page.getByText("You've reached your 1-intent limit on the free plan."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "See Premium" })).toBeVisible();
  // The one already-active intent must still show as selected.
  await expect(page.getByRole("button", { name: "✓ Coffee Chat", exact: false })).toBeVisible();
});

test("a prerequisite-blocked intent is dimmed with an explanation, not silently hidden", async ({
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
  const hiringButton = page.getByRole("button", { name: "Hiring", exact: true });
  await expect(hiringButton).toBeDisabled();

  await page.getByRole("button", { name: "Why is Hiring unavailable?" }).click();
  await expect(page.getByText("Add your company to use the Hiring intent")).toBeVisible();
});

test("denying location permission still lets onboarding complete via the manual city fallback", async ({
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
  });
  await context.addCookies(authCookies(origin, accessToken));

  // No geolocation permission is granted for this context — Chromium
  // denies the permission request outright rather than prompting, which
  // is what drives navigator.geolocation's error callback below.
  await page.goto("/setup/5");
  await expect(page).toHaveURL(/\/setup\/5$/);

  await page.getByRole("button", { name: "Use my current location" }).click();
  await expect(page.getByText("No problem — pick your city below instead.")).toBeVisible();

  await page.getByLabel("Or enter your city").fill("Jab");
  await page.getByRole("button", { name: "Jabalpur", exact: false }).click();
  await expect(page.getByText("Current location:")).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/setup\/6$/);
});

test("a zero-supply city shows the honest empty state, not an inflated promise", async ({
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
    availableNowCount: 0,
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/setup/6");
  await expect(page).toHaveURL(/\/setup\/6$/);

  await page.getByRole("button", { name: "Go available for 30 min" }).click();

  await expect(page.getByText("Only a few people are nearby right now")).toBeVisible();
  await expect(page.getByText(/\d+ people are available nearby right now\.$/)).not.toBeVisible();
});

test("real supply shows the honest positive count", async ({ page, context, baseURL }) => {
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
    availableNowCount: 14,
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/setup/6");
  await page.getByRole("button", { name: "Go available for 30 min" }).click();

  await expect(
    page.getByText("You're available now — 14 people are available nearby right now."),
  ).toBeVisible();
});
