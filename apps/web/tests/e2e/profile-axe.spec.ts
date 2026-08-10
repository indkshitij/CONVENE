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

test("own profile view is axe clean", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    full_name: "Meera Iyer",
    headline: "Director, Data Science",
    about: "16 years building NLP systems.",
    skills: [{ name: "NLP", proficiency: null, years: null }],
    experience: [
      {
        id: "exp-1",
        company_name: "Xenon Labs",
        title: "Director",
        employment_type: null,
        location_text: null,
        description: null,
        start_date: "2020-01-01",
        end_date: null,
        is_current: true,
        position: 0,
      },
    ],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/u1");
  await expect(page.getByRole("heading", { name: "Meera Iyer" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("another user's profile view is axe clean", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/candidate-1");
  await expect(page.getByText("Member candidate-1").first()).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("profile unavailable state is axe clean", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ privateProfileIds: ["private-1"] });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/private-1");
  await expect(page.getByRole("heading", { name: "This profile isn't available" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("edit profile screen is axe clean", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    headline: "Director, Data Science",
    skills: [{ name: "NLP", proficiency: null, years: null }],
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/edit");
  await expect(page.getByRole("heading", { name: "Edit profile" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
