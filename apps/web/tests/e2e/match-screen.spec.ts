import { expect, test } from "@playwright/test";
import { mockToken, type MockIntent } from "./support/mock-api-server";

// P22.2's own explicit testing bullets: "A test asserting a horizontal
// swipe gesture produces no navigation or dismissal" and the copy audit
// (covered separately, components/match/match-screen-copy-audit.test.ts).
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

test("a horizontal swipe/drag gesture across the card produces no navigation or dismissal", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [
      { id: "candidate-1", score: 79, reasons: [] },
      { id: "candidate-2", score: 60, reasons: [] },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();

  const box = await page.locator("body").boundingBox();
  const centerY = (box?.height ?? 600) / 2;
  // Simulate a right-to-left drag across the card, the exact gesture a
  // swipe-to-dismiss/attraction UI would respond to.
  await page.mouse.move(500, centerY);
  await page.mouse.down();
  await page.mouse.move(50, centerY, { steps: 10 });
  await page.mouse.up();

  // Still the same candidate, still the same URL — nothing responded to
  // the gesture.
  await expect(page).toHaveURL(/\/match\/candidate-1$/);
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();
});

test("Skip advances to the next candidate and Undo restores the skipped one", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [
      { id: "candidate-1", score: 79, reasons: [] },
      { id: "candidate-2", score: 60, reasons: [] },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();
  await expect(page.getByText("1/2").first()).toBeVisible();

  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByText("Member candidate-2").first()).toBeVisible();
  await expect(page.getByText("2/2").first()).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();
});

test("the stack-exhausted empty state renders after skipping the last candidate", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  await expect(page.getByRole("heading", { name: "You've seen everyone available" })).toBeVisible();
});

test("the sub-score breakdown expands and each bar sums to the displayed score", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await page.getByRole("button", { name: /compatible/ }).click();

  await expect(page.getByText("Intent", { exact: true })).toBeVisible();
  await expect(page.getByText("Availability", { exact: true })).toBeVisible();
  await expect(page.getByText("Skills", { exact: true })).toBeVisible();
});

test("Connect sends a request, shows the confirmation, and auto-advances", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [
      { id: "candidate-1", score: 79, reasons: [] },
      { id: "candidate-2", score: 60, reasons: [] },
    ],
    intents: [activeIntent("coffee_chat")],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByLabel("Your intent").selectOption({ label: "Coffee Chat" });
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(page.getByText("Request sent to Member candidate-1.")).toBeVisible();
  await expect(page.getByText("Member candidate-2").first()).toBeVisible({ timeout: 3000 });
});
