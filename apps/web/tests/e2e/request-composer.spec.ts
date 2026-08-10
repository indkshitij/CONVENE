import { expect, test } from "@playwright/test";
import { mockToken, type MockIntent } from "./support/mock-api-server";

// P22.3's own explicit testing bullets: "Assert a generated icebreaker
// cannot be sent without an explicit user action. Assert quota
// exhaustion shows the paywall trigger, not a generic error."
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

async function openComposer(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  origin: string,
  accessToken: string,
) {
  await context.addCookies(authCookies(origin, accessToken));
  await page.goto("/match/candidate-1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("tapping a template inserts editable text into the note field without sending anything", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
    intents: [activeIntent("coffee_chat")],
  });
  await openComposer(page, context, origin, accessToken);

  const note = page.getByLabel("Note (optional)");
  await expect(note).toHaveValue("");

  await page.getByRole("button", { name: /Shared context/ }).click();

  // The template filled the field — but nothing was sent. The dialog is
  // still open, still on the compose step, and the field is editable.
  await expect(note).not.toHaveValue("");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Request sent")).not.toBeVisible();

  // It really is editable, not a locked/pre-armed value.
  await note.fill("A completely different, hand-written note.");
  await expect(note).toHaveValue("A completely different, hand-written note.");

  // Sending is still a distinct, explicit action.
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(`Request sent to Member candidate-1.`)).toBeVisible();
});

test("quota exhaustion shows the paywall trigger, not a generic error", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
    intents: [activeIntent("coffee_chat")],
    sendConnectionRequestOutcome: "daily_limit_reached",
  });
  await openComposer(page, context, origin, accessToken);

  await page.getByRole("button", { name: "Send request" }).click();

  await expect(
    page.getByText("You've used 8 of 8 requests today. Premium gives you 30."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Upgrade for more requests per day" })).toBeVisible();
  await expect(page.getByText("0 of 8 requests left today")).toBeVisible();
});

test("a queued (throttled) send shows the queued-position copy, not a plain success message", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
    intents: [activeIntent("coffee_chat")],
    sendConnectionRequestOutcome: "queued",
  });
  await openComposer(page, context, origin, accessToken);

  await page.getByRole("button", { name: "Send request" }).click();

  await expect(page.getByText(/#4 in the queue/)).toBeVisible();
});

test("the intent selector defaults to a real complementary intent, not a blank/arbitrary choice", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
    intents: [activeIntent("hiring")], // complements "looking_for_job" per MOCK_INTENT_TAXONOMY
    candidateProfileOverrides: {
      "candidate-1": {
        intents: [{ type: "looking_for_job", detail: null, expires_at: new Date().toISOString() }],
      },
    },
  });
  await openComposer(page, context, origin, accessToken);

  await expect(page.getByLabel("Your intent")).toHaveValue("seed-hiring");
});
