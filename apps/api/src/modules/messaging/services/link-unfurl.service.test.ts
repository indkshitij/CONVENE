import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFirstUrl, LinkUnfurlService } from "./link-unfurl.service";
import { LinkUnfurlGuard, SsrfBlockedError } from "./link-unfurl-guard";

function fakeGuard(allowedHosts: readonly string[]): LinkUnfurlGuard {
  return new LinkUnfurlGuard(async (hostname: string) => {
    if (!allowedHosts.includes(hostname)) throw new Error("blocked by fake resolver");
    return [{ address: "93.184.216.34", family: 4 }];
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractFirstUrl", () => {
  it("finds the first http(s) URL in free text", () => {
    expect(extractFirstUrl("check this out https://example.com/page and more text")).toBe(
      "https://example.com/page",
    );
  });

  it("returns null when there's no URL", () => {
    expect(extractFirstUrl("just some text, no links here")).toBeNull();
  });
});

describe("LinkUnfurlService.unfurl", () => {
  it("returns null for a non-http(s) URL without ever calling the guard", async () => {
    const guard = fakeGuard(["anything"]);
    const spy = vi.spyOn(guard, "assertHostIsSafe");
    const service = new LinkUnfurlService(guard);
    const result = await service.unfurl("ftp://example.com/file");
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches and extracts OG tags for a safe host", async () => {
    const guard = fakeGuard(["example.com"]);
    const service = new LinkUnfurlService(guard);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        htmlResponse(`<html><head>
          <meta property="og:title" content="Example Title" />
          <meta property="og:description" content="Example description" />
          <meta property="og:image" content="https://example.com/img.png" />
        </head></html>`),
      ),
    );

    const preview = await service.unfurl("https://example.com/page");

    expect(preview).toEqual({
      url: "https://example.com/page",
      title: "Example Title",
      description: "Example description",
      image: "https://example.com/img.png",
    });
  });

  it("rejects a URL whose host resolves to a private address (127.0.0.1 case)", async () => {
    const guard = new LinkUnfurlGuard(async () => {
      throw new SsrfBlockedError("blocked");
    });
    const service = new LinkUnfurlService(guard);
    vi.stubGlobal("fetch", vi.fn());

    const preview = await service.unfurl("http://127.0.0.1/admin");

    expect(preview).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a URL targeting the cloud metadata address directly (169.254.169.254 case)", async () => {
    const guard = new LinkUnfurlGuard(async () => {
      throw new SsrfBlockedError("blocked");
    });
    const service = new LinkUnfurlService(guard);
    vi.stubGlobal("fetch", vi.fn());

    const preview = await service.unfurl("http://169.254.169.254/latest/meta-data/");

    expect(preview).toBeNull();
  });

  it("follows a redirect to a public host but blocks a redirect chain that ends at a private IP", async () => {
    // short.link (safe) -> 169.254.169.254 (blocked). The guard re-runs
    // on every hop, so the safe first hop must not let the second one
    // through — this is the "DNS re-resolution guard against rebinding"
    // / redirect-chain SSRF case.
    const guard = fakeGuard(["short.link"]);
    const service = new LinkUnfurlService(guard);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href.startsWith("https://short.link"))
        return redirectResponse("http://169.254.169.254/secret");
      throw new Error("should never fetch the blocked hop");
    });
    vi.stubGlobal("fetch", fetchMock);

    const preview = await service.unfurl("https://short.link/abc");

    expect(preview).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // never actually requested the blocked hop
  });

  it("follows a safe multi-hop redirect chain to completion", async () => {
    const guard = fakeGuard(["short.link", "example.com"]);
    const service = new LinkUnfurlService(guard);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href.startsWith("https://short.link"))
        return redirectResponse("https://example.com/final");
      return htmlResponse(`<title>Final Page</title>`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const preview = await service.unfurl("https://short.link/abc");

    expect(preview?.title).toBe("Final Page");
    expect(preview?.url).toBe("https://example.com/final");
  });

  it("gives up after too many redirects", async () => {
    const guard = fakeGuard(["loop.example.com"]);
    const service = new LinkUnfurlService(guard);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => redirectResponse("https://loop.example.com/again")),
    );

    const preview = await service.unfurl("https://loop.example.com/start");

    expect(preview).toBeNull();
  });

  it("returns null (never throws) when fetch itself fails", async () => {
    const guard = fakeGuard(["example.com"]);
    const service = new LinkUnfurlService(guard);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    await expect(service.unfurl("https://example.com/page")).resolves.toBeNull();
  });
});
