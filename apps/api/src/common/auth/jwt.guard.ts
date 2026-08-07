import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ForbiddenAppError, UnauthorizedAppError } from "../errors/app-error";
import { AuthContextService, type AuthContext } from "./auth-context";
import { TokenService } from "../../modules/auth/services/token.service";

export const PUBLIC_ROUTE_METADATA_KEY = "convene:public-route";
export const ONBOARDING_ALLOWED_METADATA_KEY = "convene:onboarding-allowed";

// PRD §20.3: "A route without an explicit policy fails a CI check." A
// route that's genuinely open to anyone (register, login, JWKS, health)
// declares that explicitly rather than by omission — the route-inventory
// test (P5.4) treats @Public() as satisfying the "every route has an
// explicit declaration" rule exactly like a real policy would.
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_ROUTE_METADATA_KEY, true);

// PRD §17.4 status gate: "pending_verification routes to onboarding-only
// endpoints." A handler that pending_verification users may still reach
// (e.g. the onboarding wizard's own steps) opts in explicitly; every other
// authenticated route implicitly requires `active`/`restricted`/
// `shadow_limited`.
export const OnboardingAllowed = (): MethodDecorator =>
  SetMetadata(ONBOARDING_ALLOWED_METADATA_KEY, true);

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  authContext?: AuthContext;
}

// PRD §17.4/§20.3: verifies the bearer access token, loads the (Redis-
// cached) AuthContext, applies the status gate (suspended → deny,
// pending_verification → onboarding-only), and attaches the result to
// `request.authContext` for RolesGuard/PolicyGuard and handlers downstream.
// Skipped entirely for `@Public()` routes.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly authContextService: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      PUBLIC_ROUTE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestLike>();
    const header = request.headers["authorization"];
    const value = Array.isArray(header) ? header[0] : header;
    const bearerPrefix = "Bearer ";
    if (!value || !value.startsWith(bearerPrefix)) {
      throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
    }

    let decoded;
    try {
      decoded = await this.tokenService.verifyAccessToken(value.slice(bearerPrefix.length));
    } catch {
      throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
    }

    const authContext = await this.authContextService.get(decoded.sub);
    if (!authContext || authContext.tokenVersion !== decoded.tv) {
      throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
    }

    if (authContext.status === "suspended") {
      throw new ForbiddenAppError("ACCOUNT_SUSPENDED", "This account has been suspended.");
    }

    if (authContext.status === "pending_verification") {
      const onboardingAllowed = this.reflector.getAllAndOverride<boolean | undefined>(
        ONBOARDING_ALLOWED_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!onboardingAllowed) {
        throw new ForbiddenAppError(
          "VERIFICATION_REQUIRED",
          "Please verify your account to continue.",
        );
      }
    }

    request.authContext = authContext;
    return true;
  }
}
