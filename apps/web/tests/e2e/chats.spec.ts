import { expect, test } from "@playwright/test";
import { mockToken, type MockConversationRow } from "./support/mock-api-server";

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

function conversation(overrides: Partial<MockConversationRow> = {}): MockConversationRow {
  return {
    id: "conv-1",
    participantId: "candidate-1",
    participantName: "Meera Iyer",
    lastMessage: {
      bodyPreview: "Thursday works — I'll send over the details.",
      senderId: "candidate-1",
      createdAt: new Date().toISOString(),
      type: "text",
    },
    unreadCount: 0,
    isPinned: false,
    mutedUntil: null,
    isArchived: false,
    intentType: "need_mentor",
    ...overrides,
  };
}

test("Chats list renders a conversation row with unread badge and Connected-via line", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ conversations: [conversation({ unreadCount: 2 })] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/chats");
  await expect(page.getByText("Meera Iyer").first()).toBeVisible();
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Connected via: Need Mentor/).first()).toBeVisible();
});

test("empty state offers Discover people", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ conversations: [] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/chats");
  await expect(page.getByText("Your conversations will appear here.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Discover people" })).toBeVisible();
});

test("Pinned filter shows only pinned conversations, and pinning via the row menu moves a conversation into it", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    conversations: [
      conversation({ id: "conv-pinned", participantName: "Pinned Person", isPinned: true }),
      conversation({ id: "conv-plain", participantName: "Plain Person" }),
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/chats");
  await page.getByRole("tab", { name: "Pinned" }).click();
  await expect(page.getByText("Pinned Person").first()).toBeVisible();
  await expect(page.getByText("Plain Person")).toHaveCount(0);

  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("button", { name: "Conversation actions" }).nth(1).click();
  await page.getByRole("menuitem", { name: "Pin" }).click();

  await page.getByRole("tab", { name: "Pinned" }).click();
  await expect(page.getByText("Plain Person").first()).toBeVisible();
});

test("Archive removes a conversation from the All filter", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    conversations: [conversation({ participantName: "Archive Target" })],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/chats");
  await expect(page.getByText("Archive Target").first()).toBeVisible();
  await page.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();

  await expect(page.getByText("Archive Target")).toHaveCount(0);
  await page.getByRole("tab", { name: "Archived" }).click();
  await expect(page.getByText("Archive Target").first()).toBeVisible();
});
