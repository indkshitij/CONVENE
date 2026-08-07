import { describe, expect, it } from "vitest";
import { GoogleOAuthProvider } from "./google-oauth.provider";

describe("GoogleOAuthProvider", () => {
  it("builds an authorize URL carrying state, PKCE challenge, and redirect_uri", () => {
    const provider = new GoogleOAuthProvider("client-id-123", "client-secret-456");
    const url = new URL(
      provider.buildAuthorizeUrl({
        state: "state-abc",
        codeChallenge: "challenge-xyz",
        redirectUri: "https://app.example.com/callback",
      }),
    );

    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("client-id-123");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-xyz");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/callback");
  });

  it("throws a clear error building the authorize URL when unconfigured", () => {
    const provider = new GoogleOAuthProvider(undefined, undefined);
    expect(() =>
      provider.buildAuthorizeUrl({
        state: "s",
        codeChallenge: "c",
        redirectUri: "https://app.example.com",
      }),
    ).toThrow(/not configured/);
  });

  it("throws a clear error exchanging a code when unconfigured", async () => {
    const provider = new GoogleOAuthProvider(undefined, undefined);
    await expect(
      provider.exchangeCode({
        code: "x",
        codeVerifier: "y",
        redirectUri: "https://app.example.com",
      }),
    ).rejects.toThrow(/not configured/);
  });
});
