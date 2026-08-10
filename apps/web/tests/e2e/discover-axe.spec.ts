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

test("/discover is axe clean with populated cards, an open ⋯ menu, and an open report modal", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    discoverCandidates: [{ id: "candidate-1", score: 82, reasons: ["Complementary intents"] }],
    candidateProfileOverrides: {
      "candidate-1": {
        verification: { level: 2 },
        company: { name: "Acme", verified: true },
        availability: {
          state: "available_now",
          expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
        },
      },
    },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/discover?tab=nearby");
  await expect(page.getByText("Member candidate-1")).toBeVisible();

  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "More actions" }).click();
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("menuitem", { name: "Report" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("/discover is axe clean on the empty state", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ discoverCandidates: [], discoverEmptyState: "no_supply" });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/discover?tab=nearby");
  await expect(page.getByText("No matches nearby yet — check back soon.")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
