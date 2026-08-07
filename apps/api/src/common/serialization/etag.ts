import { createHash } from "node:crypto";

// PRD §17.3/§17.9: "ETag where cacheable," used by EtagInterceptor (P3.2)
// to set the response header and by any handler that needs to validate an
// If-Match against the CURRENT representation server-side (P7.1's PATCH
// /profiles/me optimistic concurrency) — both must compute it identically,
// or a client-held ETag from a GET would never match what PATCH expects.
export function computeEtag(body: unknown): string {
  const hash = createHash("sha1").update(JSON.stringify(body)).digest("hex");
  return `"${hash}"`;
}
