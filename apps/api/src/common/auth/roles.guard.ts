import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ForbiddenAppError } from "../errors/app-error";
import type { AuthContext, Role } from "./auth-context";
import { PUBLIC_ROUTE_METADATA_KEY } from "./jwt.guard";

export const ROLES_METADATA_KEY = "convene:roles";

// PRD §17.4 RBAC matrix. Omitting `@Roles(...)` on an authenticated route
// means "any authenticated role may call this" (the matrix's own default —
// every listed capability except the admin/recruiter-only rows is ✓ for
// every role) rather than a silent deny; only routes restricted to a
// subset of roles need to declare this explicitly.
export const Roles = (...roles: Role[]): MethodDecorator => SetMetadata(ROLES_METADATA_KEY, roles);

interface RequestLike {
  authContext?: AuthContext;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      PUBLIC_ROUTE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestLike>();
    const role = request.authContext?.role;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenAppError("FORBIDDEN", "You don't have permission to do that.");
    }
    return true;
  }
}
