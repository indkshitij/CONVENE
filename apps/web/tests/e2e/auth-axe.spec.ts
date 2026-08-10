import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Explicit acceptance criterion: "axe clean."
test.describe("axe accessibility scan", () => {
  test("/login", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("/signup", async ({ page }) => {
    await page.goto("/signup");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("/verify", async ({ page }) => {
    await page.goto("/verify?identifier=test%40example.com");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
