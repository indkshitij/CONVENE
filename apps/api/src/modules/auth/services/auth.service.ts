import { profiles, refreshTokens, users } from "@convene/db";
import { auth as authValidation, common as commonValidation } from "@convene/validation";
import { Injectable, Optional } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import {
  BadRequestAppError,
  ConflictAppError,
  ForbiddenAppError,
  GoneAppError,
  LockedAppError,
  TooManyRequestsAppError,
  UnauthorizedAppError,
  ValidationAppError,
} from "../../../common/errors/app-error";
import { type Clock, systemClock } from "../../../common/clock";
import { uuidv7 } from "../../../common/utils/uuidv7";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import { EmailService } from "../../notifications/email.service";
import { LoginLockoutService } from "./login-lockout.service";
import { type OtpChannel, OtpService } from "./otp.service";
import { PasswordService } from "./password.service";
import { ACCESS_TOKEN_TTL_SECONDS, TokenService } from "./token.service";
import { VerificationService } from "./verification.service";

export type RegisterInput = z.infer<typeof authValidation.registerSchema>;
export type LoginInput = z.infer<typeof authValidation.loginSchema>;
export type OtpSendInput = z.infer<typeof authValidation.otpSendSchema>;
export type OtpVerifyInput = z.infer<typeof authValidation.otpVerifySchema>;

export interface UserResponse {
  id: string;
  full_name: string;
  email: string | null;
  email_verified: boolean;
  onboarding_step: number;
  status: string;
}

export interface TokensResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: "Bearer";
}

export interface AuthResult {
  user: UserResponse;
  tokens: TokensResponse;
}

export interface OtpSendResult {
  expires_in: number;
  resend_available_in: number;
}

// PRD §17.4/§20.4: 256-bit refresh tokens, 30-day rolling expiry.
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// §10.1.5's own error copy for the age gate — reused verbatim by the
// application-level check the P5.2 prompt asks for in addition to the DB's
// `chk_adult` constraint (defense in depth: this runs even if a caller
// bypasses the registerSchema pipe, e.g. a future OAuth path).
const AGE_RESTRICTED_MESSAGE = commonValidation.DOB_ERROR;

// Timing-normalisation placeholder used by login() when no user matches
// the submitted identifier, so argon2's (expensive, ~constant-time)
// verify cost is paid on every attempt regardless of whether the account
// exists (§10.1.7: "timing-normalised responses that never disclose
// whether an account exists").
const DUMMY_PASSWORD = "convene-enumeration-defence-placeholder-9";

@Injectable()
export class AuthService {
  private dummyPasswordHash: Promise<string> | null = null;

  constructor(
    private readonly postgres: PostgresService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly otpService: OtpService,
    private readonly verificationService: VerificationService,
    private readonly emailService: EmailService,
    private readonly loginLockout: LoginLockoutService,
    // See otp.service.ts's constructor comment: Clock is an interface, so
    // @Optional() is required for Nest DI to fall through to the default.
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  // PRD §10.1.7 endpoint 1. Enumeration defence: a verified conflict is the
  // one case the error table explicitly allows to be revealed (409); an
  // unverified conflict must "return 201 with a resend instead" without
  // ever authenticating the caller as the real account — see the inline
  // comment on the conflict branch below for how that's kept safe.
  async register(dto: RegisterInput): Promise<AuthResult> {
    if (dto.method !== "email" && dto.method !== "phone") {
      throw new BadRequestAppError("BAD_REQUEST", "This registration method isn't available yet.");
    }
    if (!dto.password) {
      throw new ValidationAppError("VALIDATION_FAILED", "A password is required.", {
        field: "password",
      });
    }

    const ageCheck = commonValidation.dobAdultSchema(this.clock.now()).safeParse(dto.date_of_birth);
    if (!ageCheck.success) {
      throw new ForbiddenAppError("AGE_RESTRICTED", AGE_RESTRICTED_MESSAGE);
    }

    if (await this.passwordService.isBreached(dto.password)) {
      throw new ValidationAppError(
        "PASSWORD_BREACHED",
        "This password has appeared in a data breach.",
        { field: "password" },
      );
    }
    // Cost-equivalent across both branches below (real insert vs.
    // enumeration-safe resend) — argon2id dominates this method's latency
    // either way, keeping the two paths timing-indistinguishable within a
    // reasonable tolerance.
    const passwordHash = await this.passwordService.hash(dto.password);

    const existing = await this.findUserByIdentifier(dto.method, dto.email, dto.phone);

    if (existing) {
      const isVerified =
        dto.method === "email"
          ? existing.emailVerifiedAt !== null
          : existing.phoneVerifiedAt !== null;

      if (isVerified) {
        throw new ConflictAppError(
          dto.method === "email" ? "EMAIL_ALREADY_EXISTS" : "PHONE_ALREADY_EXISTS",
          "An account with this contact already exists.",
        );
      }

      return this.resendUnverifiedRegistration(dto, existing.id);
    }

    const deviceFingerprint = dto.device?.fingerprint ?? "unknown";

    const created = await this.postgres.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: dto.method === "email" ? dto.email : undefined,
          phone: dto.method === "phone" ? dto.phone : undefined,
          passwordHash,
          fullName: dto.full_name,
          dateOfBirth: dto.date_of_birth,
          termsVersion: dto.accepted_terms_version,
          attribution: dto.attribution ?? {},
        })
        .returning();
      if (!user) throw new Error("AuthService: user insert returned no row");

      await tx.insert(profiles).values({ userId: user.id });

      return user;
    });

    if (dto.method === "email" && dto.email) {
      const { token } = await this.verificationService.createEmailVerificationToken(created.id);
      await this.emailService.sendVerificationEmail(dto.email, this.buildVerificationUrl(token));
    } else if (dto.method === "phone" && dto.phone) {
      await this.otpService.send(created.id, "phone");
    }

    const tokens = await this.issueTokens(
      created.id,
      created.role,
      created.tokenVersion,
      deviceFingerprint,
    );
    return { user: this.toUserResponse(created), tokens };
  }

  // PRD §10.1.7 endpoint 2. Password login, enumeration-safe on the
  // existence axis (INVALID_CREDENTIALS for both "no such account" and
  // "wrong password"); ACCOUNT_LOCKED/ACCOUNT_SUSPENDED are the two
  // exceptions the contract itself names as distinguishable outcomes.
  async login(dto: LoginInput, ip: string, deviceFingerprint: string): Promise<AuthResult> {
    const identifier = dto.email ?? dto.phone;
    if (!identifier) {
      throw new ValidationAppError("VALIDATION_FAILED", "An email or phone is required.", {
        field: "email",
      });
    }

    const lockStatus = await this.loginLockout.check(identifier, ip);
    if (lockStatus.locked) {
      throw new LockedAppError(
        "ACCOUNT_LOCKED",
        "This account is temporarily locked. Try again later.",
        {
          retryAfter: lockStatus.retryAfterSeconds,
        },
      );
    }

    const user = dto.email
      ? await this.findUserByEmail(dto.email)
      : dto.phone
        ? await this.findUserByPhone(dto.phone)
        : undefined;

    const hashToVerify = user?.passwordHash ?? (await this.getDummyPasswordHash());
    const passwordMatches = await this.passwordService.verify(hashToVerify, dto.password);

    if (!user || !passwordMatches) {
      await this.loginLockout.recordFailure(identifier, ip);
      throw new UnauthorizedAppError("INVALID_CREDENTIALS", "Incorrect email/phone or password.");
    }

    if (user.status === "suspended") {
      throw new ForbiddenAppError("ACCOUNT_SUSPENDED", "This account has been suspended.");
    }

    await this.loginLockout.reset(identifier, ip);
    const tokens = await this.issueTokens(user.id, user.role, user.tokenVersion, deviceFingerprint);
    return { user: this.toUserResponse(user), tokens };
  }

  // PRD §10.1.7 endpoint 6 (send). Contract never asks this to be
  // enumeration-safe (unlike register/login/password-reset), but silently
  // no-op-ing an unmatched identifier costs nothing and avoids adding a
  // needless disclosure surface.
  async sendOtp(dto: OtpSendInput): Promise<OtpSendResult> {
    const channel: OtpChannel = dto.identifier.includes("@") ? "email" : "phone";
    const user =
      channel === "email"
        ? await this.findUserByEmail(dto.identifier)
        : await this.findUserByPhone(dto.identifier);

    if (!user) {
      return { expires_in: 600, resend_available_in: 60 };
    }

    const result = await this.otpService.send(user.id, channel);
    if (!result.ok) {
      throw new TooManyRequestsAppError("OTP_RATE_LIMITED", "Too many OTP requests.", {
        retryAfter: result.rejection.retryAfterSeconds,
      });
    }

    return {
      expires_in: Math.round(
        (result.result.expiresAt.getTime() - this.clock.now().getTime()) / 1000,
      ),
      resend_available_in: result.result.resendAvailableInSeconds,
    };
  }

  // PRD §10.1.7 endpoint 6 (verify). Success marks the corresponding
  // contact channel verified and logs the user in, matching the contract's
  // `200 {user, tokens}`.
  async verifyOtp(dto: OtpVerifyInput, deviceFingerprint: string): Promise<AuthResult> {
    const channel: OtpChannel = dto.identifier.includes("@") ? "email" : "phone";
    const user =
      channel === "email"
        ? await this.findUserByEmail(dto.identifier)
        : await this.findUserByPhone(dto.identifier);

    if (!user) {
      throw new BadRequestAppError("OTP_INVALID", "Enter the 6-digit code.");
    }

    const result = await this.otpService.verify(user.id, channel, dto.otp);
    if (!result.ok) {
      if (result.reason === "OTP_EXPIRED") {
        throw new GoneAppError("OTP_EXPIRED", "This code has expired.");
      }
      if (result.reason === "OTP_MAX_ATTEMPTS") {
        throw new TooManyRequestsAppError("OTP_MAX_ATTEMPTS", "Too many incorrect attempts.");
      }
      throw new BadRequestAppError("OTP_INVALID", "Enter the 6-digit code.");
    }

    const now = this.clock.now();
    const [updated] = await this.postgres.db
      .update(users)
      .set(channel === "email" ? { emailVerifiedAt: now } : { phoneVerifiedAt: now })
      .where(eq(users.id, user.id))
      .returning();
    const verifiedUser = updated ?? user;

    const tokens = await this.issueTokens(
      verifiedUser.id,
      verifiedUser.role,
      verifiedUser.tokenVersion,
      deviceFingerprint,
    );
    return { user: this.toUserResponse(verifiedUser), tokens };
  }

  // PRD §10.1.7 endpoint 7 (verify). Single-use signed token; invalid and
  // used tokens are folded into the same outcomes the contract names for
  // this endpoint family rather than inventing a new code.
  async verifyEmail(token: string): Promise<void> {
    const result = await this.verificationService.consumeEmailVerificationToken(token);
    if (!result.ok) {
      if (result.reason === "TOKEN_USED") {
        throw new ConflictAppError("TOKEN_USED", "This verification link has already been used.");
      }
      throw new GoneAppError("TOKEN_EXPIRED", "This verification link has expired.");
    }

    await this.postgres.db
      .update(users)
      .set({ emailVerifiedAt: this.clock.now() })
      .where(eq(users.id, result.userId));
  }

  // PRD §10.1.7 endpoint 7 (resend). Enumeration-safe: always resolves the
  // same way regardless of whether the email matches an account.
  async resendEmailVerification(email: string): Promise<void> {
    const user = await this.findUserByEmail(email);
    if (!user || user.emailVerifiedAt) return;

    const { token } = await this.verificationService.createEmailVerificationToken(user.id);
    await this.emailService.sendVerificationEmail(email, this.buildVerificationUrl(token));
  }

  private async resendUnverifiedRegistration(
    dto: RegisterInput,
    existingUserId: string,
  ): Promise<AuthResult> {
    if (dto.method === "email" && dto.email) {
      const { token } = await this.verificationService.createEmailVerificationToken(existingUserId);
      await this.emailService.sendVerificationEmail(dto.email, this.buildVerificationUrl(token));
    } else if (dto.method === "phone" && dto.phone) {
      await this.otpService.send(existingUserId, "phone");
    }

    // Never authenticate the caller as the real (existing) account: the
    // response mirrors a genuine registration's shape (so the two are
    // indistinguishable by status/body/timing) but is signed for a
    // placeholder id that matches no real user, so it can't be used to
    // access the account being resent to. persistRefreshToken=false since
    // refresh_tokens.user_id is FK-constrained to a real users row — this
    // placeholder id has none, and persisting one for a non-existent user
    // would be a foreign-key violation as well as pointless (the token
    // could never legitimately be redeemed).
    const placeholderId = uuidv7();
    const tokens = await this.issueTokens(
      placeholderId,
      "user",
      0,
      dto.device?.fingerprint ?? "unknown",
      false,
    );
    return {
      user: {
        id: placeholderId,
        full_name: dto.full_name,
        email: dto.method === "email" ? (dto.email ?? null) : null,
        email_verified: false,
        onboarding_step: 1,
        status: "pending_verification",
      },
      tokens,
    };
  }

  private async issueTokens(
    userId: string,
    role: string,
    tokenVersion: number,
    deviceFingerprint: string,
    persistRefreshToken = true,
  ): Promise<TokensResponse> {
    const accessToken = await this.tokenService.signAccessToken({
      sub: userId,
      role,
      plan: "free",
      tv: tokenVersion,
    });
    const refreshPair = this.tokenService.generateRefreshToken();
    const now = this.clock.now();

    if (persistRefreshToken) {
      await this.postgres.db.insert(refreshTokens).values({
        userId,
        familyId: uuidv7(),
        tokenHash: refreshPair.hash,
        deviceFingerprint,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      });
    }

    return {
      access_token: accessToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshPair.token,
      token_type: "Bearer",
    };
  }

  private async getDummyPasswordHash(): Promise<string> {
    if (!this.dummyPasswordHash) {
      this.dummyPasswordHash = this.passwordService.hash(DUMMY_PASSWORD);
    }
    return this.dummyPasswordHash;
  }

  private async findUserByIdentifier(
    method: "email" | "phone",
    email: string | undefined,
    phone: string | undefined,
  ) {
    if (method === "email" && email) return this.findUserByEmail(email);
    if (method === "phone" && phone) return this.findUserByPhone(phone);
    return undefined;
  }

  private async findUserByEmail(email: string) {
    const [user] = await this.postgres.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return user;
  }

  private async findUserByPhone(phone: string) {
    const [user] = await this.postgres.db
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    return user;
  }

  private toUserResponse(user: {
    id: string;
    fullName: string;
    email: string | null;
    emailVerifiedAt: Date | null;
    onboardingStep: number;
    status: string;
  }): UserResponse {
    return {
      id: user.id,
      full_name: user.fullName,
      email: user.email,
      email_verified: user.emailVerifiedAt !== null,
      onboarding_step: user.onboardingStep,
      status: user.status,
    };
  }

  private buildVerificationUrl(token: string): string {
    return `https://convene.app/verify-email?token=${token}`;
  }
}
