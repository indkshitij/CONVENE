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

test("editing the headline autosaves on blur and shows a Saved indicator", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ headline: "Old headline about my career" });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/edit");
  const headline = page.getByLabel("Headline");
  await headline.fill("New headline describing my current role");
  await headline.blur();

  await expect(page.getByText("Saved ✓")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Headline")).toHaveValue("New headline describing my current role");
});

test("a stale save surfaces the conflict UI and never silently overwrites the server value", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({ headline: "Original headline stays put here" });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/edit");

  // Simulate "another device" changing the profile after this page
  // loaded its ETag: PATCH directly, bumping the server's etag out from
  // under the page's own held value.
  await page.request.patch("/api/profile/me", {
    headers: { "If-Match": "etag-0" },
    data: { headline: "Changed on another device right now" },
  });

  const headline = page.getByLabel("Headline");
  await headline.fill("My own conflicting edit typed here");
  await headline.blur();

  await expect(page.getByText("This profile changed elsewhere")).toBeVisible();

  const check = await page.request.get("/api/profile/me");
  const body = (await check.json()) as { headline: string };
  expect(body.headline).toBe("Changed on another device right now");
});

test("adding an experience entry appears in the list", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/edit");
  const experienceSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Experience", exact: true }) });
  await experienceSection.getByRole("button", { name: "+ Add" }).click();
  await page.getByPlaceholder("Title").fill("Staff Engineer");
  await page.getByPlaceholder("Company").fill("Xenon Labs");
  await page.getByLabel("I currently work here").check();
  const startDateInputs = page.locator('input[type="date"]');
  await startDateInputs.first().fill("2022-01-01");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Staff Engineer")).toBeVisible();
  await expect(page.getByText("Xenon Labs")).toBeVisible();
});

test("deleting an experience entry requires confirmation", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
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

  await page.goto("/profile/edit");
  await expect(page.getByText("Director")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText("Delete?")).toBeVisible();
  await expect(page.getByText("Director")).toBeVisible();

  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText("Director")).toHaveCount(0);
});

test("skills manager adds and removes chips", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/profile/edit");
  const skillsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Skills/ }) });
  await skillsSection.getByRole("textbox").fill("Rust");
  await skillsSection.getByRole("button", { name: "+ Add" }).click();
  await expect(page.getByRole("button", { name: "Remove Rust" })).toBeVisible();

  await page.getByRole("button", { name: "Remove Rust" }).click();
  await expect(page.getByRole("button", { name: "Remove Rust" })).toHaveCount(0);
});
