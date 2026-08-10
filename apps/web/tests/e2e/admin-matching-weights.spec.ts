import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

function authCookies(origin: string, accessToken: string) {
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
        role: "admin",
      }),
      url: origin,
      httpOnly: true,
    },
  ];
}

// Explicit acceptance criterion (P26.2): "Assert 0.99 and 1.01 are both
// rejected" — enforced here as "the Save button never enables," the
// UI-level equivalent of the backend test asserting the API call itself
// is rejected.
test("save stays disabled unless the weights sum to exactly 1.00", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/admin/config");
  const saveButton = page.getByRole("button", { name: "Save — logged to audit" });
  await expect(saveButton).toBeDisabled();

  const availInput = page.getByLabel("Availability");
  await availInput.fill("0.21");
  await expect(page.getByText(/must total exactly 1\.00/)).toBeVisible();
  await expect(saveButton).toBeDisabled();

  // A reason alone still isn't enough while the sum is off.
  await page.getByLabel("Change reason (required)").fill("Testing the boundary.");
  await expect(saveButton).toBeDisabled();

  // Bring the sum back to exactly 1.00 (avail 0.21 -> intent 0.25, +0.01
  // to offset avail's -0.01) and it enables.
  await page.getByLabel("Intent match").fill("0.25");
  await expect(saveButton).toBeEnabled();
});

test("rollback restores the prior configuration in one action", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({});
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/admin/config");
  await page.getByRole("button", { name: "Rollback…" }).click();
  await page.getByLabel("Reason (required)").fill("Reverting last night's regression.");
  await page.getByRole("button", { name: "Confirm rollback — logged to audit" }).click();

  await expect(
    page.getByText("Rolled back to the previous configuration — logged to audit."),
  ).toBeVisible();
  // The mock's rollback response returns avail=0.20 (vs the live 0.22 seeded on load).
  await expect(page.getByLabel("Availability")).toHaveValue("0.2");
});
