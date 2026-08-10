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

test("all nine settings sections render on one screen", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/settings/account");
  for (const heading of [
    "Account",
    "Privacy",
    "Availability",
    "Intents & inbound filters",
    "Notifications",
    "Discovery preferences",
    "Subscription & billing",
    "Data & privacy",
    "Safety",
  ]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("toggling an inbound-filter intent chip persists via PUT", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Coffee Chat" }).click();
  await expect(page.getByRole("button", { name: "Coffee Chat" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.reload();
  await expect(page.getByRole("button", { name: "Coffee Chat" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("blocked users list shows and unblock removes an entry", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    blockedUsers: [{ blocked_id: "user-9", reason: null, created_at: new Date().toISOString() }],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Blocked users" }).click();
  await expect(page.getByText("user-9")).toBeVisible();

  await page.getByRole("button", { name: "Unblock" }).click();
  await expect(page.getByText("user-9")).toHaveCount(0);
});

test("requesting account deletion shows the scheduled-deletion banner with a cancel option", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Delete account ›" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByText(/scheduled for deletion on/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/scheduled for deletion on/)).toHaveCount(0);
});
