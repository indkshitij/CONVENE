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
import { availability as availabilityValidation } from "@convene/validation";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  AvailabilityService,
  type CreateSessionInput,
  type CreateSessionResult,
  type EndSessionSummary,
  type ExtendSessionInput,
  type SessionResponse,
} from "./availability.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.3.8, endpoints 18/19/20. The route-level pipe below always
// validates against the Premium (loosest) duration bound — the real
// plan-specific bound is re-checked inside AvailabilityService.createSession
// (see that method's own comment for why).
@Controller("availability")
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Post("sessions")
  @HttpCode(201)
  @Policy(selfScoped)
  async createSession(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(availabilityValidation.createSessionSchema(true)))
    body: CreateSessionInput,
  ): Promise<CreateSessionResult> {
    const { id: userId, plan } = requireAuthContext(request);
    return this.availabilityService.createSession(userId, plan, body);
  }

  @Patch("sessions/:id/extend")
  @Policy(selfScoped)
  async extendSession(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(availabilityValidation.extendSessionSchema))
    body: ExtendSessionInput,
  ): Promise<SessionResponse> {
    const { id: userId, plan } = requireAuthContext(request);
    return this.availabilityService.extendSession(userId, id, plan, body);
  }

  @Delete("sessions/:id")
  @Policy(selfScoped)
  async endSession(
    @Req() request: RequestLike,
    @Param("id") id: string,
  ): Promise<EndSessionSummary> {
    const { id: userId } = requireAuthContext(request);
    return this.availabilityService.endSession(userId, id);
  }

  @Get("me")
  @Policy(selfScoped)
  async getCurrent(
    @Req() request: RequestLike,
  ): Promise<{ current_session: SessionResponse | null }> {
    const { id: userId } = requireAuthContext(request);
    return this.availabilityService.getCurrent(userId);
  }

  @Get("history")
  @Policy(selfScoped)
  async getHistory(
    @Req() request: RequestLike,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const { id: userId } = requireAuthContext(request);
    return this.availabilityService.getHistory(
      userId,
      from ? new Date(from) : null,
      to ? new Date(to) : null,
    );
  }
}
