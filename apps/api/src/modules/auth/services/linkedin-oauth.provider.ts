import { Injectable } from "@nestjs/common";
import { InternalAppError } from "../../../common/errors/app-error";
import type {
  OAuthAuthorizeUrlParams,
  OAuthExchangeParams,
  OAuthProfile,
  OAuthProvider,
} from "./oauth-provider";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

interface LinkedInUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

// Real LinkedIn "Sign In with LinkedIn using OpenID Connect" endpoints.
// LINKEDIN_OAUTH_CLIENT_ID/SECRET are optional env vars (see
// env.schema.ts) — same call-time-error pattern as GoogleOAuthProvider.
// LinkedIn's OIDC product doesn't document PKCE support the way Google's
// does; `code_challenge`/`code_challenge_method` are still sent per the
// PRD's blanket "PKCE for both providers" instruction; a provider that
// ignores unrecognised query params is unaffected, flagged as a possible
// provider limitation rather than silently dropped.
@Injectable()
export class LinkedInOAuthProvider implements OAuthProvider {
  constructor(
    private readonly clientId: string | undefined,
    private readonly clientSecret: string | undefined,
  ) {}

  buildAuthorizeUrl(params: OAuthAuthorizeUrlParams): string {
    const clientId = this.requireClientId();
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", params.state);
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode(params: OAuthExchangeParams): Promise<OAuthProfile> {
    const clientId = this.requireClientId();
    const clientSecret = this.requireClientSecret();

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: params.code,
        code_verifier: params.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: params.redirectUri,
      }),
    });
    if (!tokenResponse.ok) {
      throw new InternalAppError("INTERNAL_ERROR", "LinkedIn rejected the authorization code.");
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

    const userInfoResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userInfoResponse.ok) {
      throw new InternalAppError("INTERNAL_ERROR", "Could not fetch the LinkedIn user profile.");
    }
    const profile = (await userInfoResponse.json()) as LinkedInUserInfo;

    return {
      providerUid: profile.sub,
      email: profile.email ?? null,
      emailVerified: profile.email_verified ?? false,
      fullName: profile.name ?? null,
    };
  }

  private requireClientId(): string {
    if (!this.clientId) {
      throw new InternalAppError("INTERNAL_ERROR", "LinkedIn OAuth is not configured.");
    }
    return this.clientId;
  }

  private requireClientSecret(): string {
    if (!this.clientSecret) {
      throw new InternalAppError("INTERNAL_ERROR", "LinkedIn OAuth is not configured.");
    }
    return this.clientSecret;
  }
}
