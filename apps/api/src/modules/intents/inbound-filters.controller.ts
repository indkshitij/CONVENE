import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { intents as intentsValidation } from "@convene/validation";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  type InboundFiltersResponse,
  type InboundIntentFiltersInput,
  InboundFiltersService,
} from "./inbound-filters.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.4.6: `PUT /api/v1/settings/inbound-intent-filters`. The GET
// counterpart isn't in the literal contract (only PUT is) but is added
// here anyway — a settings resource with no way to read its current
// value back is a real usability gap, not a speculative feature; flagged
// as a small beyond-the-letter addition in the PR description, same
// judgment call this codebase has made before (e.g. apps/web's jsdom
// vitest environment in P0.1).
@Controller("settings/inbound-intent-filters")
export class InboundFiltersController {
  constructor(private readonly inboundFiltersService: InboundFiltersService) {}

  @Get()
  @Policy(selfScoped)
  async getFilters(@Req() request: RequestLike): Promise<InboundFiltersResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.inboundFiltersService.getFilters(userId);
  }

  @Put()
  @Policy(selfScoped)
  async updateFilters(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(intentsValidation.inboundIntentFiltersSchema))
    body: InboundIntentFiltersInput,
  ): Promise<InboundFiltersResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.inboundFiltersService.updateFilters(userId, body);
  }
}
