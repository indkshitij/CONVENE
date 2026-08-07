import { Injectable } from "@nestjs/common";
import { InternalAppError } from "../../../common/errors/app-error";
import type {
  OAuthAuthorizeUrlParams,
  OAuthExchangeParams,
  OAuthProfile,
  OAuthProvider,
} from "./oauth-provider";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

// Real Google OAuth 2.0 / OIDC endpoints. GOOGLE_OAUTH_CLIENT_ID/SECRET are
// optional env vars (see env.schema.ts) — this class throws a clear error
// at call time if a route needing Google actually gets exercised without
// them configured, rather than failing boot for every dev/test env that
// never sets up real provider credentials.
@Injectable()
export class GoogleOAuthProvider implements OAuthProvider {
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
      throw new InternalAppError("INTERNAL_ERROR", "Google rejected the authorization code.");
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

    const userInfoResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userInfoResponse.ok) {
      throw new InternalAppError("INTERNAL_ERROR", "Could not fetch the Google user profile.");
    }
    const profile = (await userInfoResponse.json()) as GoogleUserInfo;

    return {
      providerUid: profile.sub,
      email: profile.email ?? null,
      emailVerified: profile.email_verified ?? false,
      fullName: profile.name ?? null,
    };
  }

  private requireClientId(): string {
    if (!this.clientId) {
      throw new InternalAppError("INTERNAL_ERROR", "Google OAuth is not configured.");
    }
    return this.clientId;
  }

  private requireClientSecret(): string {
    if (!this.clientSecret) {
      throw new InternalAppError("INTERNAL_ERROR", "Google OAuth is not configured.");
    }
    return this.clientSecret;
  }
}
