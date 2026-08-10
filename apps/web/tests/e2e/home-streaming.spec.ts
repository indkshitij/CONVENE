import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

// P21.2's own testing bullet: "Assert an artificially slow matches query
// does not delay the availability card." design.md §14.7: "sections
// stream in independently (no blocking)."
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

test("a slow top-matches query does not delay the availability card or the other sections", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverDelayMs: 3000,
    discoverCandidates: [{ id: "candidate-1", score: 71, reasons: ["Complementary intents"] }],
    availableNowCandidates: [{ id: "candidate-2", score: 68, reasons: [] }],
    pendingRequestSenderIds: ["sender-1"],
  });
  await context.addCookies(authCookies(origin, accessToken));

  // The default waitUntil:"load" doesn't resolve until the *entire*
  // streamed response finishes — for a page with an 8s-delayed section
  // that would silently wait out the whole delay before this call even
  // returns, defeating the point of the test. "commit" resolves as soon
  // as the response starts arriving, matching how a real browser user
  // actually experiences a streaming page (content appears progressively
  // while the connection is still open).
  await page.goto("/home", { waitUntil: "commit" });

  // The availability card and the two fast sections must already be
  // showing real content well before the artificially slow top-matches
  // query resolves — proving they aren't waiting on a shared Promise.all.
  await expect(page.getByText("Go available to see who's around")).toBeVisible({ timeout: 4000 });
  await expect(page.getByRole("heading", { name: "Requests (1)" })).toBeVisible({ timeout: 4000 });
  await expect(page.getByRole("heading", { name: "Available now near you" })).toBeVisible({
    timeout: 4000,
  });

  // The slow section is still showing its skeleton at this point, not the
  // real heading yet — checked with a short timeout so a wrong result
  // fails fast rather than burning the whole delay window.
  await expect(page.getByRole("heading", { name: "Top matches" })).not.toBeVisible({
    timeout: 500,
  });

  // It does eventually stream in once the delay elapses.
  await expect(page.getByRole("heading", { name: "Top matches" })).toBeVisible({ timeout: 12_000 });
});

test("all four sections render their real (mocked) data together once loaded", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [{ id: "candidate-1", score: 71, reasons: ["Complementary intents"] }],
    availableNowCandidates: [{ id: "candidate-2", score: 68, reasons: [] }],
    pendingRequestSenderIds: ["sender-1", "sender-2"],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/home");

  await expect(page.getByRole("heading", { name: "Requests (2)" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Member sender-1/ })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Available now near you" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Member candidate-2/ })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Top matches" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Member candidate-1/ })).toBeVisible();
});

test("each section shows its own honest empty state when there's nothing to show", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [],
    availableNowCandidates: [],
    pendingRequestSenderIds: [],
    discoverEmptyState: "no_supply",
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/home");

  // Scoped to each section's own labelled region rather than a bare
  // getByText — a transient double-paint during streaming/hydration can
  // otherwise briefly trip Playwright's strict-mode duplicate check even
  // though the final DOM only ever holds one copy.
  await expect(
    page.getByRole("region", { name: /Requests/ }).getByText("No pending requests yet."),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Available now near you" })
      .getByText("No one nearby is free right now."),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Top matches" })
      .getByText("No matches nearby yet — check back soon."),
  ).toBeVisible();
});
