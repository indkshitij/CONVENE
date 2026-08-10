import { expect, test } from "@playwright/test";
import { mockToken } from "./support/mock-api-server";

// P29.3 (design.md §15's own a11y checklist: "Zoom: usable at 200% and
// at 320 px width") — confirmed by grep before this file that no test
// anywhere checked either. WCAG 1.4.10 Reflow (320 CSS px, no
// horizontal scrolling) and WCAG 1.4.4 Resize Text (200% zoom, no lost
// content/functionality) are distinct success criteria; both are
// simulated here via viewport size rather than a literal browser-zoom
// API (Playwright/Chromium has no direct "set zoom to 200%" control) —
// 200% zoom on a 1280px baseline is equivalent, for reflow purposes, to
// a 640px effective viewport, which is the standard technique for
// testing this without a real zoom control.
const REFLOW_WIDTH_PX = 320;
const SIMULATED_200_PERCENT_ZOOM_WIDTH_PX = 640;
const VIEWPORT_HEIGHT_PX = 900;

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

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1); // 1px tolerance for sub-pixel rounding
}

const SCREENS: {
  name: string;
  path: string;
  readyLocator: (page: import("@playwright/test").Page) => Promise<unknown>;
}[] = [
  {
    name: "/login",
    path: "/login",
    readyLocator: (page) => page.getByRole("heading").first().waitFor(),
  },
  {
    name: "/home",
    path: "/home",
    readyLocator: (page) => page.getByRole("heading", { name: "Top matches" }).waitFor(),
  },
  {
    name: "/discover",
    path: "/discover",
    readyLocator: (page) => page.getByRole("heading", { level: 1 }).first().waitFor(),
  },
  { name: "/chats", path: "/chats", readyLocator: (page) => page.waitForLoadState("networkidle") },
];

for (const screen of SCREENS) {
  test(`${screen.name} has no horizontal overflow at 320px width (WCAG 1.4.10 Reflow)`, async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const accessToken = mockToken({
      discoverCandidates: [{ id: "candidate-1", score: 71, reasons: ["Complementary intents"] }],
    });
    await context.addCookies(authCookies(origin, accessToken));
    await page.setViewportSize({ width: REFLOW_WIDTH_PX, height: VIEWPORT_HEIGHT_PX });

    await page.goto(screen.path);
    await screen.readyLocator(page);

    await assertNoHorizontalOverflow(page);
  });

  test(`${screen.name} has no horizontal overflow at a simulated 200% zoom`, async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const accessToken = mockToken({
      discoverCandidates: [{ id: "candidate-1", score: 71, reasons: ["Complementary intents"] }],
    });
    await context.addCookies(authCookies(origin, accessToken));
    await page.setViewportSize({
      width: SIMULATED_200_PERCENT_ZOOM_WIDTH_PX,
      height: VIEWPORT_HEIGHT_PX,
    });

    await page.goto(screen.path);
    await screen.readyLocator(page);

    await assertNoHorizontalOverflow(page);
  });
}
