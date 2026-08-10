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

test("own profile shows the completion ring and an Edit profile action", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ full_name: "Meera Iyer", headline: "Director, Data Science" });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/u1");
  await expect(page.getByRole("heading", { name: "Meera Iyer" })).toBeVisible();
  await expect(page.getByText(/\d+% complete/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit profile" })).toBeVisible();
});

test("another user's profile shows Connect when a request can be sent", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/candidate-1");
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit profile" })).toHaveCount(0);
});

test("a blocked profile (403) and a private profile (404) render identical copy — no existence signal leaks", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    blockedProfileIds: ["blocked-1"],
    privateProfileIds: ["private-1"],
  });
  await context.addCookies(authCookies(origin, accessToken));

  // The mock produces two genuinely distinct wire outcomes here (a real
  // 403 BLOCKED vs a real 404 PROFILE_NOT_FOUND) — the BFF route and
  // fetchProfileById both collapse them before this app ever renders
  // anything, so what follows asserts that collapse actually holds.
  const blockedApi = await page.request.get("/api/profile/blocked-1");
  const privateApi = await page.request.get("/api/profile/private-1");
  expect(blockedApi.status()).toBe(404);
  expect(privateApi.status()).toBe(404);
  expect(await blockedApi.json()).toEqual(await privateApi.json());

  await page.goto("/profile/blocked-1");
  await expect(page.getByRole("heading", { name: "This profile isn't available" })).toBeVisible();
  const blockedText = await page.locator("body").innerText();

  await page.goto("/profile/private-1");
  await expect(page.getByRole("heading", { name: "This profile isn't available" })).toBeVisible();
  const privateText = await page.locator("body").innerText();

  expect(blockedText).toBe(privateText);
});

test("empty sections are omitted entirely on another user's profile but show an Add CTA on your own", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ about: null, experience: [] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/candidate-1");
  await expect(page.getByText("Add your experience")).toHaveCount(0);

  await page.goto("/profile/u1");
  await expect(page.getByText("Add your experience")).toBeVisible();
});
