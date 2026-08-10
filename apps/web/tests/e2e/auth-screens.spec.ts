import { expect, test, type Page, type Route } from "@playwright/test";

// These tests exercise the CLIENT's own reaction to each server response
// (§13 F1's error branches), not the live apps/api/apps/realtime stack —
// `page.route()` intercepts the browser's own fetch to a same-origin BFF
// route before it ever reaches the Next server, so no backend needs to
// be running. What apps/api itself does with a given request is that
// service's own test suite's job; this suite's job is "does the form
// show the right UI for a given response."
async function mockJson(page: Page, url: string, status: number, body: unknown) {
  await page.route(url, async (route: Route) => {
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test.describe("Login", () => {
  test("happy path: no error shown and the API receives the right payload", async ({ page }) => {
    let requestBody: unknown = null;
    await page.route("**/api/auth/login", async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "u1",
            full_name: "Test User",
            email: "test@example.com",
            email_verified: true,
            onboarding_step: 6,
            status: "active",
          },
        }),
      });
    });

    await page.goto("/login");
    await page.getByLabel("Email or phone").fill("test@example.com");
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("correct-horse-battery-staple9");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    expect(requestBody).toEqual({
      email: "test@example.com",
      password: "correct-horse-battery-staple9",
    });
  });

  // §14.3 / explicit acceptance: "401 -> 'Email or password is incorrect'
  // (never which)."
  test("401 shows the generic, enumeration-safe error copy", async ({ page }) => {
    await mockJson(page, "**/api/auth/login", 401, {
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Incorrect email/phone or password.",
        field: null,
        details: null,
        request_id: null,
        retry_after: null,
      },
    });

    await page.goto("/login");
    await page.getByLabel("Email or phone").fill("test@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("wrong-password-123");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.locator('p[role="alert"]')).toHaveText("Email or password is incorrect.");
  });

  test("423 shows a live lockout countdown", async ({ page }) => {
    await mockJson(page, "**/api/auth/login", 423, {
      error: {
        code: "ACCOUNT_LOCKED",
        message: "locked",
        field: null,
        details: null,
        request_id: null,
        retry_after: 272,
      },
    });

    await page.goto("/login");
    await page.getByLabel("Email or phone").fill("test@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("wrong-password-123");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.locator('p[role="alert"]')).toHaveText(
      /Too many attempts — try again in 4:3\d/,
    );
  });

  test("403 suspended shows the dedicated screen with reason and appeal link", async ({ page }) => {
    await mockJson(page, "**/api/auth/login", 403, {
      error: {
        code: "ACCOUNT_SUSPENDED",
        message: "Suspended for repeated policy violations.",
        field: null,
        details: null,
        request_id: null,
        retry_after: null,
      },
    });

    await page.goto("/login");
    await page.getByLabel("Email or phone").fill("test@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("some-password-123");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("heading", { name: "Account suspended" })).toBeVisible();
    await expect(page.getByText("Suspended for repeated policy violations.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Appeal this decision" })).toBeVisible();
    await expect(page.getByLabel("Email or phone")).toHaveCount(0);
  });
});

test.describe("Signup", () => {
  async function fillValidSignup(page: Page) {
    await page.getByLabel("Full name").fill("Ada Lovelace");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("ada@example.com");
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("correct-horse-battery-staple9");
    await page.getByLabel("Date of birth").fill("1995-01-01");
    await page.getByRole("checkbox").check();
  }

  // Happy path AND the silently-resent-unverified-duplicate branch
  // produce the identical 201 response and identical UI by design (§13.2's
  // "no enumeration leak") — one test covers both.
  test("happy path (and unverified-duplicate, which looks identical): shows the check-your-email state", async ({
    page,
  }) => {
    await mockJson(page, "**/api/auth/register", 201, {
      user: {
        id: "u1",
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        email_verified: false,
        onboarding_step: 1,
        status: "pending_verification",
      },
    });

    await page.goto("/signup");
    await fillValidSignup(page);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });

  // §13.2's one sanctioned disclosure: a *verified* duplicate.
  test("409 EMAIL_ALREADY_EXISTS shows the sanctioned 'already have an account' copy", async ({
    page,
  }) => {
    await mockJson(page, "**/api/auth/register", 409, {
      error: {
        code: "EMAIL_ALREADY_EXISTS",
        message: "conflict",
        field: null,
        details: null,
        request_id: null,
        retry_after: null,
      },
    });

    await page.goto("/signup");
    await fillValidSignup(page);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("link", { name: "log in?" })).toBeVisible();
  });

  test("age gate: under-18 DOB is rejected client-side without a network call", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route("**/api/auth/register", async (route) => {
      requestCount += 1;
      await route.continue();
    });

    await page.goto("/signup");
    await fillValidSignup(page);
    const under18 = new Date();
    under18.setFullYear(under18.getFullYear() - 10);
    await page.getByLabel("Date of birth").fill(under18.toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator('p[role="alert"]')).toBeVisible();
    expect(requestCount).toBe(0);
  });

  // Defense in depth: the server can still reject on age even if the
  // client-side check were somehow bypassed.
  test("403 AGE_RESTRICTED shows the terminal age-gate screen", async ({ page }) => {
    await mockJson(page, "**/api/auth/register", 403, {
      error: {
        code: "AGE_RESTRICTED",
        message: "too young",
        field: null,
        details: null,
        request_id: null,
        retry_after: null,
      },
    });

    await page.goto("/signup");
    await fillValidSignup(page);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { name: "Convene is for adults" })).toBeVisible();
  });
});

test.describe("OTP verify", () => {
  const identifier = "test@example.com";

  test("wrong code shows a decrementing attempts-remaining message", async ({ page }) => {
    await mockJson(page, "**/api/auth/otp/verify", 401, {
      error: {
        code: "OTP_INVALID",
        message: "wrong",
        field: null,
        details: null,
        request_id: null,
        retry_after: null,
      },
    });

    await page.goto(`/verify?identifier=${encodeURIComponent(identifier)}`);
    for (const digit of "148000") {
      await page.keyboard.type(digit);
    }

    await expect(page.locator('p[role="alert"]')).toHaveText("Incorrect code. 4 tries remaining.");
  });

  test("expired code shows prominent resend messaging", async ({ page }) => {
    await mockJson(page, "**/api/auth/otp/verify", 410, {
      error: {
        code: "OTP_EXPIRED",
        message: "expired",
        field: null,
        details: null,
        request_id: null,
        retry_after: null,
      },
    });

    await page.goto(`/verify?identifier=${encodeURIComponent(identifier)}`);
    for (const digit of "148000") {
      await page.keyboard.type(digit);
    }

    await expect(page.locator('p[role="alert"]')).toHaveText(/This code expired/);
  });

  test("resend starts a live cooldown that disables the resend button", async ({ page }) => {
    await mockJson(page, "**/api/auth/otp/send", 202, { expires_in: 600, resend_available_in: 5 });

    await page.goto(`/verify?identifier=${encodeURIComponent(identifier)}`);
    await page.getByRole("button", { name: "Resend code" }).click();

    const resendButton = page.getByRole("button", { name: /Resend code in 0:0\d/ });
    await expect(resendButton).toBeVisible();
    await expect(resendButton).toBeDisabled();
  });
});
