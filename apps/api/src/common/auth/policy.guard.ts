import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ForbiddenAppError, InternalAppError } from "../errors/app-error";
import type { AuthContext } from "./auth-context";
import { PUBLIC_ROUTE_METADATA_KEY } from "./jwt.guard";

export const POLICY_METADATA_KEY = "convene:policy";

// PRD §20.3: "Policies are pure functions ... with 100% unit-test
// coverage." The function itself stays pure (see policies/*.ts); it's the
// guard's job to gather whatever the function needs from the request/
// authContext and pass those in as plain arguments.
export type PolicyCheckFn = (
  authContext: AuthContext,
  request: unknown,
) => boolean | Promise<boolean>;

export const Policy = (fn: PolicyCheckFn): MethodDecorator => SetMetadata(POLICY_METADATA_KEY, fn);

interface RequestLike {
  authContext?: AuthContext;
}

// PRD §20.3: "Deny by default ... a route without an explicit policy fails
// a CI check." The route-inventory test (P5.4) is the primary enforcement
// mechanism; this guard's own hard failure on a missing policy is defence
// in depth for anything that check might miss (e.g. a route added and
// tested in isolation without running the full inventory).
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      PUBLIC_ROUTE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const policyFn = this.reflector.getAllAndOverride<PolicyCheckFn | undefined>(
      POLICY_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!policyFn) {
      throw new InternalAppError(
        "INTERNAL_ERROR",
        "This route is missing a required policy declaration.",
      );
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    if (!request.authContext) {
      throw new InternalAppError("INTERNAL_ERROR", "PolicyGuard ran without an auth context.");
    }

    const allowed = await policyFn(request.authContext, request);
    if (!allowed) {
      throw new ForbiddenAppError("POLICY_DENIED", "You don't have permission to do that.");
    }
    return true;
  }
}
