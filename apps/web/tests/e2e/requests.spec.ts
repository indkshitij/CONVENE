import { expect, test } from "@playwright/test";
import { mockToken, type MockRequestRow } from "./support/mock-api-server";

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

function pendingRequest(overrides: Partial<MockRequestRow> = {}): MockRequestRow {
  return {
    id: "req-1",
    direction: "received",
    status: "pending",
    counterpartyId: "candidate-1",
    matchScore: 82,
    matchReasons: ["Complementary intents"],
    ...overrides,
  };
}

test("Received tab shows a pending request and Accept removes it from the pending list", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ requests: [pendingRequest()] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/requests");
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();

  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Member candidate-1")).toHaveCount(0);
});

test("Received tab Decline removes the request from the pending list", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ requests: [pendingRequest()] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/requests");
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();

  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Member candidate-1")).toHaveCount(0);
});

test("Received tab empty state offers Browse discover", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ requests: [] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/requests");
  await expect(page.getByText("No requests yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse discover" })).toBeVisible();
});

test("Sent tab's UI is identical before and after the recipient rejects — silent rejection stays airtight", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    requests: [
      pendingRequest({ id: "req-sent-1", direction: "sent", counterpartyId: "candidate-2" }),
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/requests");
  await page.getByRole("tab", { name: /Sent/ }).click();
  await expect(page.getByText("Member candidate-2")).toBeVisible();
  const beforeText = await page.locator("main, body").first().innerText();

  // Simulate the recipient rejecting — the same endpoint their own UI
  // would call — directly against the mock, bypassing this browser's own
  // session (this mock has no separate per-user identity to drive a real
  // second browser context with).
  const response = await page.request.post(`/api/connections/requests/req-sent-1/reject`);
  expect([200, 204]).toContain(response.status());

  await page.reload();
  await page.getByRole("tab", { name: /Sent/ }).click();
  await expect(page.getByText("Member candidate-2")).toBeVisible();
  const afterText = await page.locator("main, body").first().innerText();

  expect(afterText).toBe(beforeText);
  expect(afterText.toLowerCase()).not.toContain("reject");
  expect(afterText.toLowerCase()).not.toContain("declin");
});

test("Sent tab shows Expired once a silently-rejected request's expiry passes", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    requests: [
      pendingRequest({
        id: "req-sent-2",
        direction: "sent",
        status: "rejected",
        counterpartyId: "candidate-3",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/requests");
  await page.getByRole("tab", { name: /Sent/ }).click();
  await expect(page.getByText("Expired")).toBeVisible();
});

test("throttle banner renders when queued requests are present on Received", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    requests: [pendingRequest()],
    requestsThrottle: { enabled: true, daily_cap: 5, queued_count: 2 },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/requests");
  await expect(page.getByText(/2 requests are queued/).first()).toBeVisible();
});
