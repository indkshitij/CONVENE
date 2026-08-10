import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { intents as intentsValidation } from "@convene/validation";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { anyAuthenticatedUser, selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { INTENT_TAXONOMY, type IntentTaxonomyEntry } from "./intent-taxonomy";
import {
  type CreateIntentInput,
  type CreateIntentResult,
  type IntentResponse,
  IntentsService,
  type RenewIntentInput,
  type UpdateIntentInput,
} from "./intents.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.4.6. Routes act on the caller's own intents implicitly (no
// `:userId` segment) — every route is `@Policy(selfScoped)` except the
// taxonomy endpoint, which is static reference data available to any
// authenticated user (mirrors taxonomy.controller.ts's own skills/
// industries endpoints).
@Controller("intents")
export class IntentsController {
  constructor(private readonly intentsService: IntentsService) {}

  @Get("taxonomy")
  @Policy(anyAuthenticatedUser)
  getTaxonomy(): IntentTaxonomyEntry[] {
    return INTENT_TAXONOMY;
  }

  @Get()
  @Policy(selfScoped)
  async listIntents(
    @Req() request: RequestLike,
    @Query("include_archived") includeArchived?: string,
  ): Promise<IntentResponse[]> {
    const { id: userId } = requireAuthContext(request);
    return this.intentsService.listIntents(userId, includeArchived === "true");
  }

  @Post()
  @HttpCode(201)
  @Policy(selfScoped)
  async createIntent(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(intentsValidation.createIntentSchema)) body: CreateIntentInput,
  ): Promise<CreateIntentResult> {
    const { id: userId, plan } = requireAuthContext(request);
    return this.intentsService.createIntent(userId, plan, body);
  }

  @Patch(":id")
  @Policy(selfScoped)
  async updateIntent(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(intentsValidation.updateIntentSchema)) body: UpdateIntentInput,
  ): Promise<IntentResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.intentsService.updateIntent(userId, id, body);
  }

  @Post(":id/renew")
  @Policy(selfScoped)
  async renewIntent(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(intentsValidation.renewIntentSchema)) body: RenewIntentInput,
  ): Promise<IntentResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.intentsService.renewIntent(userId, id, body);
  }

  @Post(":id/primary")
  @Policy(selfScoped)
  async setPrimary(@Req() request: RequestLike, @Param("id") id: string): Promise<IntentResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.intentsService.setPrimary(userId, id);
  }

  @Delete(":id")
  @HttpCode(204)
  @Policy(selfScoped)
  async deleteIntent(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.intentsService.deleteIntent(userId, id);
  }
}
