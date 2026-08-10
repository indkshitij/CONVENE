import type { MetadataRoute } from "next";

// §18.5: "robots.ts disallows /app, /admin, /api." Route groups
// ((app), (admin)) don't appear in the URL, so the disallow rules target
// the actual authenticated path prefixes this app resolves to
// (/home, /discover, /chats, /profile, /settings, /notifications,
// /premium, /search, /requests, /match, /admin, /api, /setup) rather
// than the group folder names themselves, which were never real URLs.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/home",
        "/discover",
        "/match",
        "/requests",
        "/chats",
        "/profile",
        "/search",
        "/notifications",
        "/premium",
        "/settings",
        "/setup",
        "/admin",
        "/api",
      ],
    },
  };
}
