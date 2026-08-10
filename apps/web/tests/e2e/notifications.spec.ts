import { expect, test } from "@playwright/test";
import { mockToken, type MockNotificationRow } from "./support/mock-api-server";

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

function notification(overrides: Partial<MockNotificationRow> = {}): MockNotificationRow {
  return {
    id: "notif-1",
    category: "request_accepted",
    title: "Your connection request was accepted",
    body: null,
    data: { conversationId: "conv-1" },
    priority: "normal",
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

test("today's notifications render with a Message action for request_accepted", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ notifications: [notification()] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/notifications");
  await expect(page.getByText("Your connection request was accepted")).toBeVisible();
  await expect(page.getByRole("link", { name: "Message" })).toHaveAttribute(
    "href",
    "/chats/conv-1",
  );
});

test("tapping an unread notification marks it read", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ notifications: [notification()] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/notifications");
  await page.getByRole("button", { name: /Mark as read/ }).click();
  await expect(page.getByRole("button", { name: /Mark as read/ })).toHaveCount(0);
});

test("Mark all read clears the unread count", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    notifications: [
      notification({ id: "n1" }),
      notification({ id: "n2", category: "moderation_action", title: "Your message was removed" }),
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/notifications");
  await expect(page.getByRole("button", { name: "Mark all read" })).toBeVisible();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
});

test("empty state says you're all caught up", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ notifications: [] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/notifications");
  await expect(page.getByText("You're all caught up.")).toBeVisible();
});
