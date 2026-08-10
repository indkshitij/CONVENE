import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

// P29.3: axe coverage across all 11 §13 journeys — F4 "Become Available"
// was the one journey with no axe check anywhere (confirmed by grep: no
// AxeBuilder usage touches the availability-card at all before this
// file). home-axe.spec.ts's two existing tests happen to exercise the
// card's inactive and active states as a side effect of seeding
// currentSession or not, but neither was written with F4 in mind and
// neither covers the "expiring soon" `role="alert"` banner
// (availability-card.tsx), which only renders in a narrow time window
// and has never been axe-scanned.
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

test("availability card is axe clean in its inactive ('Go available') state", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/home");
  await expect(page.getByRole("button", { name: /Go available/ })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("availability card is axe clean while active with time comfortably remaining", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    currentSession: {
      id: "s1",
      state: "available_now",
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      duration_minutes: 30,
      extensions_used: 0,
      extensions_remaining: 3,
      note: "Free for coffee chats",
      session_intents: [],
    },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/home");
  await expect(page.getByRole("button", { name: "+15 min" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

// The narrow gap this file exists to close: the `role="alert"` "Ending
// soon" banner only renders inside the T-5min window — a distinct DOM
// shape from the other two states, never previously scanned.
test("availability card is axe clean in its 'expiring soon' alert state", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    currentSession: {
      id: "s1",
      state: "available_now",
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3 * 60_000).toISOString(),
      duration_minutes: 30,
      extensions_used: 0,
      extensions_remaining: 3,
      note: null,
      session_intents: [],
    },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/home");
  await expect(page.getByRole("alert")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
