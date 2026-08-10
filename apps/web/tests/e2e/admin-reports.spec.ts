import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

function authCookies(origin: string, accessToken: string, role: string) {
  return [
    { name: "access_token", value: accessToken, url: origin, httpOnly: true },
    {
      name: "session_user",
      value: JSON.stringify({
        id: "u1",
        full_name: "Test Admin",
        email: "admin@example.com",
        email_verified: true,
        onboarding_step: 6,
        status: "active",
        role,
      }),
      url: origin,
      httpOnly: true,
    },
  ];
}

// P26.1: role-gating at the layout level (design.md §14.20 / PRD §18.1).
test("a non-admin visiting /admin is redirected away, never sees the shell", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken, "user"));

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/home$/);
});

test("an admin sees the report queue and can expand a row", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken, "admin"));

  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { name: /Reports/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Harassment or hate" })).toBeVisible();

  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("You should really consider quitting your job.")).toBeVisible();
});

// Explicit acceptance criterion: the action panel's "mandatory
// policy-clause selection" (design.md §14.20) must be enforced in the
// UI, not just documented — the Apply button starts disabled and only
// enables once a clause, a rationale, and an action are all present.
test("the apply-action button stays disabled until a policy clause, rationale, and action are all chosen", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken, "admin"));

  await page.goto("/admin/reports");
  await page.getByRole("button", { name: "Review" }).click();

  const applyButton = page.getByRole("button", { name: "Apply — logged to audit" });
  await expect(applyButton).toBeDisabled();

  await page.getByLabel("Policy clause (required)").selectOption("3.1");
  await expect(applyButton).toBeDisabled();

  await page
    .getByLabel("Rationale (required)")
    .fill("Repeated harassment after being asked to stop.");
  await expect(applyButton).toBeDisabled();

  await page.getByRole("radio", { name: "Warning" }).check();
  await expect(applyButton).toBeEnabled();
});
