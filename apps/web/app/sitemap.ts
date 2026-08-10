import type { MetadataRoute } from "next";

// Marketing/public surfaces only — everything authenticated is excluded
// per §18.5 (also covered by robots.ts's disallow rules).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://convene.example";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
