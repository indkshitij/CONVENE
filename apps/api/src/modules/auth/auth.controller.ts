import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UsePipes,
} from "@nestjs/common";
import { auth as authValidation } from "@convene/validation";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { Public } from "../../common/auth/jwt.guard";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { RateLimit } from "../../common/rate-limit/rate-limit.decorator";
import {
  type AuthResult,
  AuthService,
  type LoginInput,
  type OtpSendInput,
  type OtpSendResult,
  type OtpVerifyInput,
  type RegisterInput,
} from "./services/auth.service";
import { type Jwk, JwksService } from "./services/jwks.service";
import {
  type SessionSummary,
  RefreshService,
  type TokensResponse,
} from "./services/refresh.service";
import { PasswordLifecycleService } from "./services/password-lifecycle.service";
import { AccountDeletionService } from "./services/account-deletion.service";
import {
  type CallbackResult,
  type OAuthProviderName,
  type StartResult,
  OAuthService,
} from "./services/oauth.service";

// PRD §17.4: "both the current and previous public keys published at
// /.well-known/jwks.json so in-flight tokens survive rotation." Public —
// anyone (including a client whose access token just expired) must be
// able to fetch verification keys.
@Controller(".well-known")
export class AuthController {
  constructor(private readonly jwks: JwksService) {}

  @Get("jwks.json")
  @Public()
  getJwks(): Promise<{ keys: Jwk[] }> {
    return this.jwks.getJwks();
  }
}

interface RequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  authContext?: AuthContext;
}

interface CookieResponseLike {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
}

const REFRESH_COOKIE_NAME = "refresh_token";
// PRD §10.1.7: "sets the refresh cookie httpOnly/Secure/SameSite=Strict."
const REFRESH_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function resolveIp(request: RequestLike): string {
  const forwarded = request.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return request.ip ?? forwardedIp ?? "unknown-ip";
}

// No cookie-parser middleware is registered (nothing else needs it yet),
// so the refresh cookie is read directly off the raw Cookie header rather
// than pulling in a new dependency for one field.
function readCookie(request: RequestLike, name: string): string | null {
  const header = request.headers["cookie"];
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.1.7 endpoints 1, 2, 6, 7, 3, 4, 5, 9 (P5.2 + P5.3). Every
// non-@Public() route below is scoped to the caller's own resources by
// construction (no other user's id ever reaches these handlers), hence
// `@Policy(selfScoped)` rather than a per-resource ownership check.
// 8/10/11 (OAuth, password lifecycle, deletion) are P5.5.
@Controller("auth")
export class AuthActionsController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshService: RefreshService,
    private readonly passwordLifecycleService: PasswordLifecycleService,
    private readonly accountDeletionService: AccountDeletionService,
    private readonly oauthService: OAuthService,
  ) {}

  @Post("register")
  @HttpCode(201)
  @Public()
  @RateLimit({ scope: "register-ip" })
  @UsePipes(new ZodValidationPipe(authValidation.registerSchema))
  async register(
    @Body() dto: RegisterInput,
    @Res({ passthrough: true }) response: CookieResponseLike,
  ): Promise<AuthResult> {
    const result = await this.authService.register(dto);
    this.setRefreshCookie(response, result.tokens.refresh_token);
    return result;
  }

  @Post("login")
  @HttpCode(200)
  @Public()
  @RateLimit({ scope: "login-attempts-ip" })
  @UsePipes(new ZodValidationPipe(authValidation.loginSchema))
  async login(
    @Body() dto: LoginInput,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: CookieResponseLike,
  ): Promise<AuthResult> {
    const result = await this.authService.login(dto, resolveIp(request), "unknown");
    this.setRefreshCookie(response, result.tokens.refresh_token);
    return result;
  }

  @Post("otp/send")
  @HttpCode(202)
  @Public()
  @RateLimit({ scope: "otp-send-hourly" })
  @UsePipes(new ZodValidationPipe(authValidation.otpSendSchema))
  sendOtp(@Body() dto: OtpSendInput): Promise<OtpSendResult> {
    return this.authService.sendOtp(dto);
  }

  @Post("otp/verify")
  @HttpCode(200)
  @Public()
  @UsePipes(new ZodValidationPipe(authValidation.otpVerifySchema))
  async verifyOtp(
    @Body() dto: OtpVerifyInput,
    @Res({ passthrough: true }) response: CookieResponseLike,
  ): Promise<AuthResult> {
    const result = await this.authService.verifyOtp(dto, "unknown");
    this.setRefreshCookie(response, result.tokens.refresh_token);
    return result;
  }

  @Post("email/verify")
  @HttpCode(200)
  @Public()
  async verifyEmail(@Body("token") token: string): Promise<{ verified: true }> {
    await this.authService.verifyEmail(token);
    return { verified: true };
  }

  @Post("email/verify/resend")
  @HttpCode(202)
  @Public()
  @RateLimit({ scope: "otp-send-hourly" })
  async resendEmailVerification(@Body("email") email: string): Promise<{ accepted: true }> {
    await this.authService.resendEmailVerification(email);
    return { accepted: true };
  }

  // PRD §10.1.7 endpoint 3. Public: the refresh cookie itself is the
  // credential here, not a bearer access token (which may well already be
  // expired — that's the whole point of calling this route).
  @Post("refresh")
  @HttpCode(200)
  @Public()
  async refresh(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: CookieResponseLike,
  ): Promise<{ tokens: TokensResponse }> {
    const rawToken = readCookie(request, REFRESH_COOKIE_NAME);
    if (!rawToken) {
      throw new UnauthorizedAppError("INVALID_REFRESH_TOKEN", "This session is no longer valid.");
    }
    const tokens = await this.refreshService.refresh(rawToken, "unknown");
    this.setRefreshCookie(response, tokens.refresh_token);
    return { tokens };
  }

  // PRD §10.1.7 endpoint 4.
  @Post("logout")
  @HttpCode(204)
  @Policy(selfScoped)
  async logout(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: CookieResponseLike,
  ): Promise<void> {
    requireAuthContext(request);
    const rawToken = readCookie(request, REFRESH_COOKIE_NAME);
    if (rawToken) await this.refreshService.logout(rawToken);
    response.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
  }

  // PRD §10.1.7 endpoint 5.
  @Post("logout-all")
  @HttpCode(204)
  @Policy(selfScoped)
  async logoutAll(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: CookieResponseLike,
  ): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.refreshService.logoutAll(userId);
    response.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
  }

  // PRD §10.1.7 endpoint 9 (GET).
  @Get("sessions")
  @HttpCode(200)
  @Policy(selfScoped)
  async listSessions(@Req() request: RequestLike): Promise<{ sessions: SessionSummary[] }> {
    const { id: userId } = requireAuthContext(request);
    const rawToken = readCookie(request, REFRESH_COOKIE_NAME);
    const currentFamilyId = rawToken
      ? await this.refreshService.findFamilyIdByRawToken(rawToken)
      : null;
    const sessions = await this.refreshService.listSessions(userId, currentFamilyId);
    return { sessions };
  }

  // PRD §10.1.7 endpoint 9 (DELETE).
  @Delete("sessions/:id")
  @HttpCode(204)
  @Policy(selfScoped)
  async revokeSession(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.refreshService.revokeSession(userId, id);
  }

  // PRD §10.1.7 endpoint 8 (forgot). "202 (always, regardless of
  // existence)" — enumeration-safe by construction.
  @Post("password/forgot")
  @HttpCode(202)
  @Public()
  @RateLimit({ scope: "password-reset" })
  @UsePipes(new ZodValidationPipe(authValidation.passwordResetRequestSchema))
  async forgotPassword(@Body() dto: { email: string }): Promise<{ accepted: true }> {
    await this.passwordLifecycleService.forgotPassword(dto.email);
    return { accepted: true };
  }

  // PRD §10.1.7 endpoint 8 (reset). BR-AUTH-11: invalidates every refresh
  // token for the account.
  @Post("password/reset")
  @HttpCode(200)
  @Public()
  @UsePipes(new ZodValidationPipe(authValidation.passwordResetSchema))
  async resetPassword(@Body() dto: { token: string; password: string }): Promise<{ reset: true }> {
    await this.passwordLifecycleService.resetPassword(dto.token, dto.password);
    return { reset: true };
  }

  // PRD §10.1.7 endpoint 8 (change). Authenticated — the current password
  // itself is the "resource ownership" proof, so `selfScoped` applies.
  @Post("password/change")
  @HttpCode(200)
  @Policy(selfScoped)
  @UsePipes(new ZodValidationPipe(authValidation.passwordChangeSchema))
  async changePassword(
    @Req() request: RequestLike,
    @Body() dto: { current_password: string; new_password: string },
  ): Promise<{ changed: true }> {
    const { id: userId } = requireAuthContext(request);
    await this.passwordLifecycleService.changePassword(
      userId,
      dto.current_password,
      dto.new_password,
    );
    return { changed: true };
  }

  // PRD §10.1.7 endpoint 11 (delete). §20.6: immediate deactivation, a
  // 30-day grace window, purge_at set for the (separately built) retention
  // worker.
  @Post("account/delete")
  @HttpCode(202)
  @Policy(selfScoped)
  async requestAccountDeletion(
    @Req() request: RequestLike,
  ): Promise<{ purge_scheduled_at: string }> {
    const { id: userId } = requireAuthContext(request);
    const result = await this.accountDeletionService.requestDeletion(userId);
    return { purge_scheduled_at: result.purgeScheduledAt.toISOString() };
  }

  // PRD §10.1.7 endpoint 11 (cancel-delete). "One-tap cancel" during the
  // grace window restores full access.
  @Post("account/cancel-delete")
  @HttpCode(200)
  @Policy(selfScoped)
  async cancelAccountDeletion(@Req() request: RequestLike): Promise<{ cancelled: true }> {
    const { id: userId } = requireAuthContext(request);
    await this.accountDeletionService.cancelDeletion(userId);
    return { cancelled: true };
  }

  // PRD §10.1.7 endpoint 10 (start — not in the literal endpoint list; see
  // oauth.service.ts's header comment for why it's a necessary addition).
  @Post("oauth/:provider/start")
  @HttpCode(200)
  @Public()
  async oauthStart(
    @Param("provider", new ZodValidationPipe(authValidation.oauthProviderSchema))
    provider: OAuthProviderName,
    @Body(new ZodValidationPipe(authValidation.oauthStartSchema)) dto: { redirect_uri: string },
  ): Promise<StartResult> {
    return this.oauthService.start(provider, dto.redirect_uri);
  }

  // PRD §10.1.7 endpoint 10 (callback): "200 {user, tokens, is_new_user,
  // link_confirmation_required}."
  @Post("oauth/:provider/callback")
  @HttpCode(200)
  @Public()
  async oauthCallback(
    @Param("provider", new ZodValidationPipe(authValidation.oauthProviderSchema))
    provider: OAuthProviderName,
    @Body(new ZodValidationPipe(authValidation.oauthCallbackSchema))
    dto: { code: string; state: string; accepted_terms_version: string },
    @Res({ passthrough: true }) response: CookieResponseLike,
  ): Promise<CallbackResult> {
    const result = await this.oauthService.callback(
      provider,
      dto.code,
      dto.state,
      "unknown",
      dto.accepted_terms_version,
    );
    if (result.tokens) this.setRefreshCookie(response, result.tokens.refresh_token);
    return result;
  }

  // §13 F1: "explicit link confirmation + password check" — the follow-up
  // to a callback that returned link_confirmation_required: true.
  @Post("oauth/confirm-link")
  @HttpCode(200)
  @Public()
  @UsePipes(new ZodValidationPipe(authValidation.oauthConfirmLinkSchema))
  async oauthConfirmLink(
    @Body() dto: { link_token: string; password: string },
    @Res({ passthrough: true }) response: CookieResponseLike,
  ): Promise<CallbackResult> {
    const result = await this.oauthService.confirmLink(dto.link_token, dto.password, "unknown");
    if (result.tokens) this.setRefreshCookie(response, result.tokens.refresh_token);
    return result;
  }

  private setRefreshCookie(response: CookieResponseLike, token: string): void {
    response.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: REFRESH_COOKIE_TTL_MS,
      path: "/",
    });
  }
}
