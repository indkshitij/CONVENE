import { expect, test } from "@playwright/test";
import { mockToken, type MockIntent } from "./support/mock-api-server";

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

test("a real AI-drafted opener is labelled and insertable, and templates remain available alongside it", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
    intents: [activeIntent("coffee_chat")],
    aiIcebreakers: {
      status: "ok",
      openers: [
        {
          type: "specific_observation",
          text: "You wrote about reconciliation at scale — how do you handle idempotency?",
        },
        { type: "shared_context", text: "Fellow Kafka user here — same ordering issues." },
        {
          type: "direct_ask",
          text: "I'm looking for 20 minutes to sanity-check a decision — up for it?",
        },
      ],
    },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(
    page.getByText("✦ AI Suggested (optional — tap to insert, then edit)"),
  ).toBeVisible();
  await expect(page.getByText("Templates (optional — tap to insert, then edit)")).toBeVisible();

  await page.getByRole("button", { name: /Fellow Kafka user here/ }).click();
  await expect(page.getByLabel("Note")).toHaveValue(
    "Fellow Kafka user here — same ordering issues.",
  );
});

test("when AI icebreakers are unavailable, only the curated templates render — the degraded-mode fallback", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
    intents: [activeIntent("coffee_chat")],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByText("✦ AI Suggested (optional — tap to insert, then edit)")).toHaveCount(
    0,
  );
  await expect(page.getByText("Templates (optional — tap to insert, then edit)")).toBeVisible();
});

test("sending a request drafted from an AI suggestion reports the guardrail metric without blocking the send", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    availableNowCandidates: [{ id: "candidate-1", score: 79, reasons: [] }],
    intents: [activeIntent("coffee_chat")],
    aiIcebreakers: {
      status: "ok",
      openers: [{ type: "direct_ask", text: "Up for 20 minutes this week?" }],
    },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/match/candidate-1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: /Up for 20 minutes this week/ }).click();

  const metricRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/ai/first-message-metric") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Send request" }).click();
  const request = await metricRequest;
  expect(request.postDataJSON()).toEqual({ ai_drafted: true });

  await expect(page.getByText("Request sent to Member candidate-1.")).toBeVisible();
});
