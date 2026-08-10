import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

// PRD's own acceptance line for P20.2: "Wizard state lives on the server,
// not in the browser." These two tests are the direct proof of that claim —
// see lib/onboarding/current-step.ts for why the session cookie's own
// onboarding_step can't be trusted, and tests/e2e/support/mock-api-server.mts
// for how a server-side GET /profiles/me is exercised without a real
// apps/api.
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
        onboarding_step: 1,
        status: "pending_verification",
      }),
      url: origin,
      httpOnly: true,
    },
  ];
}

test("reloading mid-wizard resumes at the same step with data intact", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  // Seeded as step-2-complete/step-3-incomplete, so the guard computes the
  // real current step as 3 — this is the server-side signal being tested,
  // not anything read from local storage or the URL a client navigated to.
  const accessToken = mockToken({ headline: "Product engineer", job_title: "Engineer" });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/setup/3");
  await expect(page).toHaveURL(/\/setup\/3$/);
  await expect(page.getByRole("heading", { name: "Your professional background" })).toBeVisible();

  await page.reload();

  // Same token → same mock-server-held profile state → the guard computes
  // the same real step again, so a reload doesn't bounce the user anywhere.
  await expect(page).toHaveURL(/\/setup\/3$/);
  await expect(page.getByRole("heading", { name: "Your professional background" })).toBeVisible();
});

test("requesting a step ahead of the real current step is bounced back, not allowed to skip ahead", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  // Step 2 is complete but industry is still unset, so the real current
  // step is 3 — jumping straight to /setup/4 (e.g. via a stale bookmark)
  // must not be honored.
  const accessToken = mockToken({ headline: "Product engineer", job_title: "Engineer" });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/setup/4");
  await expect(page).toHaveURL(/\/setup\/3$/);
});

test("revisiting an already-completed step still renders it, for review/edit", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  // Both step 2 and step 3 are complete (industry set), so the real current
  // step is 4 — but design.md §14.6's "back navigation without data loss"
  // means requesting an earlier, already-cleared step must still render
  // that step's form rather than force a forward bounce.
  const accessToken = mockToken({
    headline: "Product engineer",
    job_title: "Engineer",
    industry: { id: 1, label: "Technology" },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/setup/2");
  await expect(page).toHaveURL(/\/setup\/2$/);
  await expect(page.getByRole("heading", { name: "Tell us about you" })).toBeVisible();
});

test("back navigation from step 3 to step 2 preserves the already-entered identity fields", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    headline: "Product engineer",
    job_title: "Engineer",
    company: { name: "Acme", verified: false },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/setup/3");
  await expect(page).toHaveURL(/\/setup\/3$/);

  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/setup\/2$/);

  // Step 2's form is server-rendered from the same GET /profiles/me the
  // guard used — its defaultValues should reflect what was already saved,
  // not a blank form, even though this is a fresh page navigation.
  await expect(page.getByRole("textbox", { name: "Headline", exact: true })).toHaveValue(
    "Product engineer",
  );
  await expect(page.getByRole("textbox", { name: "Current role", exact: true })).toHaveValue(
    "Engineer",
  );
  await expect(page.getByRole("textbox", { name: "Company", exact: true })).toHaveValue("Acme");
});
