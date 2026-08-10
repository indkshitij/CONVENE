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

test("/chats is axe clean with populated conversations", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    conversations: [
      {
        id: "conv-1",
        participantId: "candidate-1",
        participantName: "Meera Iyer",
        lastMessage: {
          bodyPreview: "Thursday works.",
          senderId: "candidate-1",
          createdAt: new Date().toISOString(),
          type: "text",
        },
        unreadCount: 2,
        isPinned: true,
        intentType: "need_mentor",
      },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/chats");
  await expect(page.getByText("Meera Iyer").first()).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("/chats is axe clean when empty", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ conversations: [] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/chats");
  await expect(page.getByText("Your conversations will appear here.").first()).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
