import { Injectable, Optional } from "@nestjs/common";
import { LinkUnfurlGuard, SsrfBlockedError } from "./link-unfurl-guard";

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
}

const FETCH_TIMEOUT_MS = 3_000; // §10.7.9 edge case 9: "3 s timeout."
// P29.2 security review: the PRD is internally inconsistent here —
// §10.7.9's feature spec says "5 redirects max," but §20.1's T11 (SSRF)
// threat-model row says "no redirects followed beyond 2 hops." Sided
// with the stricter security-table value since tightening an SSRF guard
// has no functional cost (an og:tag unfurl essentially never needs more
// than 1-2 redirects) and this constant exists specifically to bound
// attacker-controlled redirect chains, which is exactly what §20.1 is
// about. Flagged here rather than silently picking one.
const MAX_REDIRECTS = 2;
const MAX_BODY_BYTES = 512 * 1024; // Cap how much of the response we ever read.
const FIRST_URL_PATTERN = /https?:\/\/[^\s<>"')]+/i;

export function extractFirstUrl(text: string): string | null {
  const match = FIRST_URL_PATTERN.exec(text);
  return match ? match[0] : null;
}

// §10.7.3 "Link previews": server-side unfurl, SSRF-guarded. The guard
// (link-unfurl-guard.ts) is re-run before *every* hop of the redirect
// chain, not just the first URL — a target that resolves safely but
// redirects to a private address is exactly the "redirect chain to a
// private IP" case this defends against.
@Injectable()
export class LinkUnfurlService {
  constructor(@Optional() private readonly guard: LinkUnfurlGuard = new LinkUnfurlGuard()) {}

  async unfurl(rawUrl: string): Promise<LinkPreview | null> {
    let currentUrl: URL;
    try {
      currentUrl = new URL(rawUrl);
    } catch {
      return null;
    }
    if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") return null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        await this.guard.assertHostIsSafe(currentUrl.hostname);
      } catch (err) {
        if (err instanceof SsrfBlockedError) return null;
        throw err;
      }

      const response = await this.fetchWithTimeout(currentUrl);
      if (response === null) return null;

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        try {
          currentUrl = new URL(location, currentUrl);
        } catch {
          return null;
        }
        continue;
      }

      if (!response.ok) return null;
      const body = await this.readCappedBody(response);
      return { url: currentUrl.toString(), ...parseOpenGraphTags(body) };
    }

    return null; // Too many redirects.
  }

  private async fetchWithTimeout(url: URL): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { redirect: "manual", signal: controller.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readCappedBody(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let result = "";
    let bytesRead = 0;
    while (bytesRead < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      result += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
    return result;
  }
}

function parseOpenGraphTags(html: string): {
  title: string | null;
  description: string | null;
  image: string | null;
} {
  return {
    title: matchOgTag(html, "og:title") ?? matchTitleTag(html),
    description: matchOgTag(html, "og:description"),
    image: matchOgTag(html, "og:image"),
  };
}

function matchOgTag(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const match = pattern.exec(html);
  return match?.[1] ?? null;
}

function matchTitleTag(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? null;
}
