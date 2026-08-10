import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Convene",
    short_name: "Convene",
    description: "Real-time intent-based professional networking.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0069e0",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
