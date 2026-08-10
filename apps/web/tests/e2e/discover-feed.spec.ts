import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

// P22.1's own testing bullets: "Assert no coordinates or sub-2km distance
// appears in any rendered output or network payload. Assert each
// empty-state variant renders."
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

test("no coordinates or sub-2km distance appear in the rendered card or any network payload", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [{ id: "candidate-1", score: 82, reasons: ["Complementary intents"] }],
    candidateProfileOverrides: {
      "candidate-1": { verification: { level: 2 }, company: { name: "Acme", verified: true } },
    },
  });
  await context.addCookies(authCookies(origin, accessToken));

  const payloads: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/api/discover") || response.url().includes("/api/profile")) {
      payloads.push(await response.text().catch(() => ""));
    }
  });

  await page.goto("/discover?tab=nearby");
  await expect(page.getByText("Member candidate-1")).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  // BR-LOC-02: exact coordinates never leave the server. The mock's own
  // synthetic profile carries no lat/lng at all, and this asserts that
  // invariant holds all the way through the network + render pipeline —
  // a regression that started leaking coordinates would fail here.
  expect(bodyText).not.toMatch(/-?\d{1,3}\.\d{3,},\s*-?\d{1,3}\.\d{3,}/);
  expect(bodyText.toLowerCase()).not.toContain("latitude");
  expect(bodyText.toLowerCase()).not.toContain("longitude");
  // BR-LOC-02's bucket table has no bucket finer than "Under 2 km away" —
  // an exact sub-2km figure like "1.2 km" would only appear if something
  // started serializing real distance instead of the bucket label.
  expect(bodyText).not.toMatch(/\b(0|1)(\.\d+)?\s*km\b/);

  for (const payload of payloads) {
    expect(payload.toLowerCase()).not.toContain("latitude");
    expect(payload.toLowerCase()).not.toContain("longitude");
    expect(payload).not.toMatch(/-?\d{1,3}\.\d{3,},\s*-?\d{1,3}\.\d{3,}/);
  }
});

test("score chip is hidden below the display floor of 40", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [
      { id: "candidate-low", score: 22, reasons: [] },
      { id: "candidate-high", score: 82, reasons: [] },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/discover?tab=nearby");
  await expect(page.getByText("Member candidate-low")).toBeVisible();
  await expect(page.getByText("Member candidate-high")).toBeVisible();

  await expect(page.getByText("✦ 82")).toBeVisible();
  await expect(page.getByText("✦ 22")).not.toBeVisible();
});

test.describe("each empty-state reason renders its own honest copy", () => {
  const cases: {
    reason: "no_supply" | "all_filtered" | "all_seen" | "profile_incomplete";
    expectedText: string;
  }[] = [
    { reason: "no_supply", expectedText: "No matches nearby yet — check back soon." },
    { reason: "all_filtered", expectedText: "No matches right now — try widening your search." },
    { reason: "all_seen", expectedText: "You've seen everyone for now — check back later." },
    { reason: "profile_incomplete", expectedText: "Finish your profile to start seeing matches." },
  ];

  for (const { reason, expectedText } of cases) {
    test(`empty_state = ${reason}`, async ({ page, context, baseURL }) => {
      const origin = new URL(baseURL!).origin;
      const accessToken = mockToken({ discoverCandidates: [], discoverEmptyState: reason });
      await context.addCookies(authCookies(origin, accessToken));

      await page.goto("/discover?tab=nearby");
      await expect(page.getByText(expectedText)).toBeVisible();
    });
  }
});

test("Not interested hides the card immediately and Undo restores it within the 5s window", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [
      { id: "candidate-1", score: 82, reasons: [] },
      { id: "candidate-2", score: 70, reasons: [] },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/discover?tab=nearby");
  await expect(page.getByText("Member candidate-1")).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Not interested" }).click();

  await expect(page.getByText("Member candidate-1")).not.toBeVisible();
  await expect(page.getByText("Not interested")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Member candidate-1")).toBeVisible();
});

test("section headers group candidates by location tier", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [
      { id: "candidate-near", score: 80, reasons: [], tier: 0 },
      { id: "candidate-far", score: 60, reasons: [], tier: 4 },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/discover?tab=nearby");
  await expect(page.getByRole("heading", { name: /Nearby · 1/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Across the country · 1/ })).toBeVisible();
});
