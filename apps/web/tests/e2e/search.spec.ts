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

test("searching renders real result cards", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    searchResults: [
      {
        user_id: "candidate-1",
        full_name: "Meera Iyer",
        headline: "Director, Data Science",
        job_title: null,
        company_name: "Xenon Labs",
        verification_level: 2,
      },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/search");
  await page.getByRole("textbox", { name: "Search" }).fill("nlp mentor");
  await page.getByRole("textbox", { name: "Search" }).press("Enter");

  await expect(page.getByText("Meera Iyer").first()).toBeVisible();
  await expect(page.getByText("Xenon Labs").first()).toBeVisible();
});

test("no results shows the honest empty-results copy", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ searchResults: [] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/search");
  await page.getByRole("textbox", { name: "Search" }).fill("nobody here");
  await page.getByRole("textbox", { name: "Search" }).press("Enter");

  await expect(page.getByText('No one matches "nobody here".')).toBeVisible();
});

test("a free-plan user's filter sheet shows locked Premium filters with a specific label and a Learn link", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ plan: "free" });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/search");
  await page.getByRole("button", { name: "Filters" }).click();

  await expect(page.getByText("🔒 Filter by skills is a Premium feature")).toBeVisible();
  await expect(page.getByRole("link", { name: "Learn" }).first()).toBeVisible();
});
