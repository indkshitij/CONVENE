// PRD §10.1.7 endpoint 10 / P5.5: "Google and LinkedIn OAuth with PKCE and
// state validation." One abstraction per provider (same DI-for-
// testability pattern as HTTP_FETCHER/EMAIL_TRANSPORT/KEY_PROVIDER
// elsewhere in this module) so tests inject a fake provider instead of
// calling the real Google/LinkedIn endpoints.
export interface OAuthProfile {
  providerUid: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
}

export interface OAuthAuthorizeUrlParams {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface OAuthExchangeParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthProvider {
  buildAuthorizeUrl(params: OAuthAuthorizeUrlParams): string;
  exchangeCode(params: OAuthExchangeParams): Promise<OAuthProfile>;
}

export const GOOGLE_OAUTH_PROVIDER = "GOOGLE_OAUTH_PROVIDER";
export const LINKEDIN_OAUTH_PROVIDER = "LINKEDIN_OAUTH_PROVIDER";
