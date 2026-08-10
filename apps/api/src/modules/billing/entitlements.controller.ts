import { Controller, Get, Req } from "@nestjs/common";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { EntitlementsService, type EntitlementsResult } from "./entitlements.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// P24.2's own Implementation line: "Entitlements read from the server on
// every gated action" — this is that one real read, not a client-side
// guess at limits.
@Controller("entitlements")
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get()
  @Policy(anyAuthenticatedUser)
  async getEntitlements(@Req() request: RequestLike): Promise<EntitlementsResult> {
    const { id: userId, plan } = requireAuthContext(request);
    return this.entitlementsService.getEntitlements(userId, plan);
  }
}
