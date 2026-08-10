import { expect, test } from "@playwright/test";

// PRD §18.5: "noindex present on all authenticated routes." (auth) is
// also excluded (there's nothing to index and no reason to invite
// crawlers to a login/signup form) — (onboarding) and (admin) too.
test.describe("noindex on authenticated/non-indexable surfaces", () => {
  test("(auth) login carries noindex", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("(onboarding) setup step carries noindex when accessible", async ({
    page,
    context,
    baseURL,
  }) => {
    // Onboarding's own guard lives at (app)/layout.tsx for the *complete*
    // check; the (onboarding) group itself has no auth guard of its own
    // (a user reaches it via redirect, but the page must still render
    // correctly and stay noindex if visited directly per §18.1/§18.5).
    void context;
    void baseURL;
    await page.goto("/setup/1");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("(app) route carries noindex (redirect target still tagged)", async ({ page }) => {
    // Unauthenticated, so this redirects to /login — /login itself must
    // also be noindex, which the assertion above already covers; this
    // confirms the redirect actually happens (the (app) layout's own
    // metadata never gets a chance to render for an anonymous visitor,
    // which is the correct behaviour, not a gap — there's nothing to
    // index on a route nobody unauthenticated can ever see).
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("marketing landing page is indexable (no noindex)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });
});
