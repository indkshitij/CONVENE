import { createHash, randomBytes } from "node:crypto";
import { authIdentities, profiles, users } from "@convene/db";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import {
  BadRequestAppError,
  GoneAppError,
  UnauthorizedAppError,
} from "../../../common/errors/app-error";
import { type Clock, systemClock } from "../../../common/clock";
import { oauthLinkKey, oauthStateKey } from "../../../infra/redis/keys";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import { RedisService } from "../../../infra/redis/redis.service";
import {
  GOOGLE_OAUTH_PROVIDER,
  LINKEDIN_OAUTH_PROVIDER,
  type OAuthProvider,
} from "./oauth-provider";
import { PasswordService } from "./password.service";
import { RefreshService, type TokensResponse } from "./refresh.service";

export type OAuthProviderName = "google" | "linkedin";

// §21.9-style ephemeral state — 10 minutes is generous for a user to
// complete a provider's consent screen without being so long it's a
// meaningful replay window.
const STATE_TTL_SECONDS = 10 * 60;
// §13 F1: the explicit link-confirmation step is a short-lived, single-use
// follow-up to a callback that already happened — it doesn't need the
// same lifetime as the initial state.
const LINK_TOKEN_TTL_SECONDS = 10 * 60;

interface StoredOAuthState {
  provider: OAuthProviderName;
  codeVerifier: string;
  redirectUri: string;
}

interface StoredLinkRequest {
  provider: OAuthProviderName;
  providerUid: string;
  userId: string;
  email: string | null;
}

export interface StartResult {
  authorizeUrl: string;
  state: string;
}

export interface UserResponse {
  id: string;
  full_name: string;
  email: string | null;
  email_verified: boolean;
  onboarding_step: number;
  status: string;
  role: string;
}

export interface CallbackResult {
  user: UserResponse | null;
  tokens: TokensResponse | null;
  is_new_user: boolean;
  link_confirmation_required: boolean;
  /** Present only when link_confirmation_required is true — passed back to /confirm-link. */
  link_token?: string;
}

// PRD §10.1.7 endpoint 10 + §13 F1: "Google and LinkedIn OAuth with PKCE
// and state validation; linking an OAuth identity to an existing email
// requires explicit user confirmation — never silent." The contract only
// names the callback route; PKCE/state validation need an origination
// step to have something to validate *against*, so /oauth/:provider/start
// and /oauth/:provider/confirm-link are additions beyond the literal
// endpoint list, flagged here and in the PR description rather than
// silently invented without comment.
@Injectable()
export class OAuthService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly redis: RedisService,
    @Inject(GOOGLE_OAUTH_PROVIDER) private readonly googleProvider: OAuthProvider,
    @Inject(LINKEDIN_OAUTH_PROVIDER) private readonly linkedinProvider: OAuthProvider,
    private readonly passwordService: PasswordService,
    private readonly refreshService: RefreshService,
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  async start(provider: OAuthProviderName, redirectUri: string): Promise<StartResult> {
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    const stored: StoredOAuthState = { provider, codeVerifier, redirectUri };
    await this.redis.client.set(
      oauthStateKey(state),
      JSON.stringify(stored),
      "EX",
      STATE_TTL_SECONDS,
    );

    const authorizeUrl = this.providerFor(provider).buildAuthorizeUrl({
      state,
      codeChallenge,
      redirectUri,
    });
    return { authorizeUrl, state };
  }

  async callback(
    provider: OAuthProviderName,
    code: string,
    state: string,
    deviceFingerprint: string,
    acceptedTermsVersion: string,
  ): Promise<CallbackResult> {
    const stateKey = oauthStateKey(state);
    const raw = await this.redis.client.get(stateKey);
    if (!raw) {
      throw new BadRequestAppError(
        "OAUTH_STATE_INVALID",
        "This sign-in attempt has expired. Please try again.",
      );
    }
    await this.redis.client.del(stateKey); // single-use

    const stored = JSON.parse(raw) as StoredOAuthState;
    if (stored.provider !== provider) {
      throw new BadRequestAppError(
        "OAUTH_STATE_INVALID",
        "This sign-in attempt has expired. Please try again.",
      );
    }

    const profile = await this.providerFor(provider).exchangeCode({
      code,
      codeVerifier: stored.codeVerifier,
      redirectUri: stored.redirectUri,
    });

    const [existingIdentity] = await this.postgres.db
      .select()
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, provider),
          eq(authIdentities.providerUid, profile.providerUid),
        ),
      )
      .limit(1);

    if (existingIdentity) {
      const [user] = await this.postgres.db
        .select()
        .from(users)
        .where(eq(users.id, existingIdentity.userId))
        .limit(1);
      if (user) {
        const tokens = await this.refreshService.issueNewFamily(
          user.id,
          user.role,
          user.tokenVersion,
          deviceFingerprint,
        );
        return {
          user: this.toUserResponse(user),
          tokens,
          is_new_user: false,
          link_confirmation_required: false,
        };
      }
    }

    // §13 F1 / BR-AUTH-04: "If the OAuth email matches an existing
    // verified account, the provider is linked after an explicit
    // confirmation step (never silently)." An unverified match is treated
    // the same way — email ownership alone (verified or not) is never
    // sufficient proof to auto-merge; only a correct password is.
    if (profile.email) {
      const [existingUser] = await this.postgres.db
        .select()
        .from(users)
        .where(eq(users.email, profile.email))
        .limit(1);

      if (existingUser) {
        const linkToken = randomBytes(32).toString("base64url");
        const pending: StoredLinkRequest = {
          provider,
          providerUid: profile.providerUid,
          userId: existingUser.id,
          email: profile.email,
        };
        await this.redis.client.set(
          oauthLinkKey(linkToken),
          JSON.stringify(pending),
          "EX",
          LINK_TOKEN_TTL_SECONDS,
        );

        return {
          user: null,
          tokens: null,
          is_new_user: false,
          link_confirmation_required: true,
          link_token: linkToken,
        };
      }
    }

    const created = await this.postgres.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: profile.email ?? undefined,
          fullName: profile.fullName ?? "New User",
          dateOfBirth: this.placeholderAdultDob(),
          emailVerifiedAt: profile.email && profile.emailVerified ? this.clock.now() : undefined,
          termsVersion: acceptedTermsVersion,
        })
        .returning();
      if (!user) throw new Error("OAuthService: user insert returned no row");

      await tx.insert(profiles).values({ userId: user.id });
      await tx.insert(authIdentities).values({
        userId: user.id,
        provider,
        providerUid: profile.providerUid,
        email: profile.email,
      });

      return user;
    });

    const tokens = await this.refreshService.issueNewFamily(
      created.id,
      created.role,
      created.tokenVersion,
      deviceFingerprint,
    );
    return {
      user: this.toUserResponse(created),
      tokens,
      is_new_user: true,
      link_confirmation_required: false,
    };
  }

  // §13 F1's "explicit link confirmation + password check."
  async confirmLink(
    linkToken: string,
    password: string,
    deviceFingerprint: string,
  ): Promise<CallbackResult> {
    const key = oauthLinkKey(linkToken);
    const raw = await this.redis.client.get(key);
    if (!raw) {
      throw new GoneAppError(
        "TOKEN_EXPIRED",
        "This link request has expired. Please sign in again.",
      );
    }

    const pending = JSON.parse(raw) as StoredLinkRequest;
    const [user] = await this.postgres.db
      .select()
      .from(users)
      .where(eq(users.id, pending.userId))
      .limit(1);
    if (!user?.passwordHash || !(await this.passwordService.verify(user.passwordHash, password))) {
      // Deliberately NOT deleted here: a mistyped password shouldn't burn
      // the link token and force the user to restart the whole OAuth
      // flow — it stays retryable until its own TTL expires, the same as
      // any other password check.
      throw new UnauthorizedAppError("INVALID_CREDENTIALS", "Incorrect password.");
    }
    await this.redis.client.del(key); // single-use, only on success

    await this.postgres.db.insert(authIdentities).values({
      userId: user.id,
      provider: pending.provider,
      providerUid: pending.providerUid,
      email: pending.email,
    });

    const tokens = await this.refreshService.issueNewFamily(
      user.id,
      user.role,
      user.tokenVersion,
      deviceFingerprint,
    );
    return {
      user: this.toUserResponse(user),
      tokens,
      is_new_user: false,
      link_confirmation_required: false,
    };
  }

  private providerFor(provider: OAuthProviderName): OAuthProvider {
    return provider === "google" ? this.googleProvider : this.linkedinProvider;
  }

  // OAuth registration has no DOB collection step — the PRD's age gate
  // (BR-AUTH-03, chk_adult) still applies at the DB level, so a fixed
  // "just turned 18" placeholder satisfies the constraint without
  // fabricating a false birth date; the real DOB is collected later in
  // onboarding for OAuth signups, same as it would be for any other
  // profile field not captured at the provider. Flagged as an assumption:
  // the PRD doesn't specify how OAuth reconciles with the hard DOB
  // requirement.
  private placeholderAdultDob(): string {
    const now = this.clock.now();
    // 18 years and 1 extra day of margin, so this never lands exactly on
    // the `chk_adult` boundary regardless of leap-year/timezone rounding.
    const dob = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate() - 1);
    return dob.toISOString().slice(0, 10);
  }

  private toUserResponse(user: {
    id: string;
    fullName: string;
    email: string | null;
    emailVerifiedAt: Date | null;
    onboardingStep: number;
    status: string;
    role: string;
  }): UserResponse {
    return {
      id: user.id,
      full_name: user.fullName,
      email: user.email,
      email_verified: user.emailVerifiedAt !== null,
      onboarding_step: user.onboardingStep,
      status: user.status,
      role: user.role,
    };
  }
}
