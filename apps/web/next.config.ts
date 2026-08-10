import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright.config.ts's webServer runs `next dev` bound to 127.0.0.1
  // (not localhost) so Playwright's own requests don't trip Next's
  // dev-origin cross-origin-request guard.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
