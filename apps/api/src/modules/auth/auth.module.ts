import { isAbsolute, join } from "node:path";
import { Module } from "@nestjs/common";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { AuthContextModule } from "../../common/auth/auth-context.module";
import {
  EMAIL_TRANSPORT,
  ConsoleEmailTransport,
  EmailService,
} from "../notifications/email.service";
import { AuthActionsController, AuthController } from "./auth.controller";
import { AccountDeletionService } from "./services/account-deletion.service";
import { AuthService } from "./services/auth.service";
import { GoogleOAuthProvider } from "./services/google-oauth.provider";
import { LinkedInOAuthProvider } from "./services/linkedin-oauth.provider";
import { LoginLockoutService } from "./services/login-lockout.service";
import { GOOGLE_OAUTH_PROVIDER, LINKEDIN_OAUTH_PROVIDER } from "./services/oauth-provider";
import { OAuthService } from "./services/oauth.service";
import { OtpService } from "./services/otp.service";
import { PasswordLifecycleService } from "./services/password-lifecycle.service";
import { HTTP_FETCHER, PasswordService } from "./services/password.service";
import { KEY_PROVIDER, JwksService, LocalFileKeyProvider } from "./services/jwks.service";
import { RefreshService } from "./services/refresh.service";
import { TokenService } from "./services/token.service";
import { VerificationService } from "./services/verification.service";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P5.1: password hashing, RS256 tokens, JWKS. P5.2: registration,
// verification, login. P5.3: refresh rotation with reuse detection,
// logout, sessions. P5.4: guards/RBAC/policies. P5.5: password lifecycle,
// account deletion, OAuth.
@Module({
  imports: [AuthContextModule],
  controllers: [AuthController, AuthActionsController],
  providers: [
    { provide: HTTP_FETCHER, useValue: (url: string) => fetch(url) },
    // Dev/test default — swapped for a real EmailTransport (SMTP/managed
    // provider) in production by whichever deployment config wires this
    // module up; not this prompt's scope to build that transport.
    { provide: EMAIL_TRANSPORT, useClass: ConsoleEmailTransport },
    {
      provide: KEY_PROVIDER,
      useFactory: (env: Env) => {
        const path = isAbsolute(env.JWKS_KEYS_PATH)
          ? env.JWKS_KEYS_PATH
          : join(process.cwd(), env.JWKS_KEYS_PATH);
        return new LocalFileKeyProvider(path);
      },
      inject: [ENV],
    },
    {
      provide: GOOGLE_OAUTH_PROVIDER,
      useFactory: (env: Env) =>
        new GoogleOAuthProvider(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET),
      inject: [ENV],
    },
    {
      provide: LINKEDIN_OAUTH_PROVIDER,
      useFactory: (env: Env) =>
        new LinkedInOAuthProvider(env.LINKEDIN_OAUTH_CLIENT_ID, env.LINKEDIN_OAUTH_CLIENT_SECRET),
      inject: [ENV],
    },
    PasswordService,
    JwksService,
    TokenService,
    OtpService,
    VerificationService,
    EmailService,
    LoginLockoutService,
    AuthService,
    RefreshService,
    PasswordLifecycleService,
    AccountDeletionService,
    OAuthService,
  ],
  exports: [PasswordService, JwksService, TokenService, VerificationService, EmailService],
})
export class AuthModule {}
