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
  SchedulesService,
  type CreateScheduleInput,
  type CreateScheduleResult,
  type ScheduleResponse,
  type UpdateScheduleInput,
} from "./schedules.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.3.8 endpoint 22. The route-level pipe validates against "now"
// at request time (createScheduleSchema is a factory the same way
// dobAdultSchema/scheduleStartAtSchema already are elsewhere) — a fresh
// instance per request, not a module-level singleton, so "start_at must
// be in the future" is judged against the real clock.
@Controller("availability/schedules")
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Post()
  @HttpCode(201)
  @Policy(selfScoped)
  async createSchedule(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(availabilityValidation.createScheduleSchema()))
    body: CreateScheduleInput,
  ): Promise<CreateScheduleResult> {
    const { id: userId, plan } = requireAuthContext(request);
    return this.schedulesService.createSchedule(userId, plan, body);
  }

  @Patch(":id")
  @Policy(selfScoped)
  async updateSchedule(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(availabilityValidation.updateScheduleSchema))
    body: UpdateScheduleInput,
  ): Promise<ScheduleResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.schedulesService.updateSchedule(userId, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Policy(selfScoped)
  async deleteSchedule(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.schedulesService.deleteSchedule(userId, id);
  }

  @Get()
  @Policy(selfScoped)
  async listSchedules(@Req() request: RequestLike, @Query("expand_until") expandUntil?: string) {
    const { id: userId } = requireAuthContext(request);
    return this.schedulesService.listSchedules(userId, expandUntil ? new Date(expandUntil) : null);
  }
}
