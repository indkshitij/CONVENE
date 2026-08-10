import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

// P21.1's own acceptance line: "Server time is authoritative in the UI as
// well as the API." These tests prove the three explicit testing bullets
// from the prompt: clock skew doesn't change the displayed expiry target,
// reduced-motion removes the pulse, and the countdown doesn't spam a live
// region.
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

// Mirrors lib/availability/countdown.ts's own formatCountdown exactly
// (unit-tested there in isolation) — duplicated here rather than
// imported since Playwright's test runner doesn't resolve this app's
// "@/*" path alias the way Vitest does.
function formatMmSs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function sessionExpiringInMinutes(minutes: number) {
  return {
    id: "seed-session",
    state: "available_now",
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
    duration_minutes: 30,
    extensions_used: 0,
    extensions_remaining: 3,
    note: null,
    session_intents: [],
  };
}

test("the countdown always recomputes from the server's expires_at, never a client-remembered duration a skewed clock could extend", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const expiresAt = new Date(Date.now() + 10 * 60_000); // 10 min from "now"

  const accessToken = mockToken({
    headline: "Product engineer",
    job_title: "Engineer",
    industry: { id: 1, label: "Technology" },
    currentSession: { ...sessionExpiringInMinutes(0), expires_at: expiresAt.toISOString() },
  });
  await context.addCookies(authCookies(origin, accessToken));

  // Navigate on the real clock first — freezing time before hydration
  // stalls the app (React/Next's own internal scheduling needs a live
  // clock to ever mount). Only once the page has actually rendered is
  // the clock captured and paused, anchored to whatever the real "now"
  // happened to be at that instant.
  await page.goto("/home");
  const countdown = page.locator('[aria-live="off"]').filter({ hasText: /^\d/ });
  await expect(countdown).toBeVisible();

  const pausedAtMs = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pausedAtMs);
  const remainingAtPauseMs = expiresAt.getTime() - pausedAtMs;
  await expect(countdown).toHaveText(formatMmSs(remainingAtPauseMs));

  // Normal elapsed time: 3 minutes pass.
  await page.clock.fastForward("03:00");
  await expect(countdown).toHaveText(formatMmSs(remainingAtPauseMs - 3 * 60_000));

  // Simulate a skewed/rolled-back client clock: jump the browser's own
  // system time back to the paused instant. If the countdown were
  // computed from "duration remembered at mount minus elapsed client
  // time," this would be indistinguishable from a real 3-minute rewind
  // and could be used to make a session appear to last longer than the
  // server issued. Because it instead always re-derives from the
  // untouched expires_at, the display honestly reflects `expires_at -
  // (this now, however wrong)` — back to the original reading — with no
  // separate mutable session-length state anywhere for the skew to have
  // corrupted.
  await page.clock.setSystemTime(pausedAtMs);
  await page.clock.fastForward("00:01"); // one tick to let the interval re-render against the rewound clock
  await expect(countdown).toHaveText(formatMmSs(remainingAtPauseMs - 1000));
});

test("reduced motion removes the pulse (a single iteration lands the ring back at its resting scale)", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    headline: "Product engineer",
    job_title: "Engineer",
    industry: { id: 1, label: "Technology" },
    currentSession: sessionExpiringInMinutes(30),
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/home");

  const ring = page.locator(".availability-pulse-ring");
  await expect(ring).toBeVisible();
  const iterationCount = await ring.evaluate((el) => getComputedStyle(el).animationIterationCount);
  const durationSeconds = await ring.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).animationDuration),
  );
  // globals.css's sitewide reduced-motion block forces exactly one
  // near-instant iteration for every animation — the pulse's own
  // keyframes start and end at the same scale/opacity, so one iteration
  // settles on a static ring rather than a visible pulse. Browsers
  // normalize the computed animation-duration to seconds (e.g. "1e-05s"
  // rather than the source "0.01ms") — comparing the parsed numeric
  // value sidesteps that formatting difference.
  expect(iterationCount).toBe("1");
  expect(durationSeconds).toBeLessThan(0.001);
});

test("without reduced motion, the pulse runs the full 2s infinite animation", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const accessToken = mockToken({
    headline: "Product engineer",
    job_title: "Engineer",
    industry: { id: 1, label: "Technology" },
    currentSession: sessionExpiringInMinutes(30),
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/home");

  const ring = page.locator(".availability-pulse-ring");
  const iterationCount = await ring.evaluate((el) => getComputedStyle(el).animationIterationCount);
  const duration = await ring.evaluate((el) => getComputedStyle(el).animationDuration);
  expect(iterationCount).toBe("infinite");
  expect(duration).toBe("2s");
});

test("the countdown number is aria-live=off and only one polite announcement fires when crossing T-5min, not on every tick", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  // Seeded comfortably above the 5-minute threshold (with slack for real
  // page-load time before the clock is paused) so a short fast-forward
  // reliably crosses it, without needing the full ~25 minutes a
  // freshly-started 30-minute session would require.
  const expiresAt = new Date(Date.now() + 5 * 60_000 + 20_000);

  const accessToken = mockToken({
    headline: "Product engineer",
    job_title: "Engineer",
    industry: { id: 1, label: "Technology" },
    currentSession: { ...sessionExpiringInMinutes(0), expires_at: expiresAt.toISOString() },
  });
  await context.addCookies(authCookies(origin, accessToken));

  await page.goto("/home");
  const countdown = page.locator('[aria-live="off"]').filter({ hasText: /^\d/ });
  await expect(countdown).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));

  const liveRegion = page.locator('[role="status"][aria-live="polite"]');
  await expect(liveRegion).toHaveText("");

  // Cross the T-5min threshold.
  await page.clock.fastForward("00:25");
  await expect(liveRegion).toHaveText("Your availability ends in 5 minutes.");

  // Several more ticks pass, still inside the expiring-soon window — the
  // announcement text must not be re-set/duplicated on every tick.
  await page.clock.fastForward("00:05");
  await expect(liveRegion).toHaveText("Your availability ends in 5 minutes.");
});
