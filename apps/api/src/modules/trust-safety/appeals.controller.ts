import type { Appeal } from "@convene/db";
import { safety as safetyValidation } from "@convene/validation";
import { Body, Controller, Post, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AppealsService } from "./services/appeals.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type CreateAppealBody = z.infer<typeof safetyValidation.createAppealSchema>;

interface AppealCard {
  id: string;
  moderation_action_id: string;
  status: string;
  sla_due_at: string;
  created_at: string;
}

function toCard(row: Appeal): AppealCard {
  return {
    id: row.id,
    moderation_action_id: row.moderationActionId,
    status: row.status,
    sla_due_at: row.slaDueAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

// PRD §10.10 endpoint 52: POST /appeals.
@Controller("appeals")
export class AppealsController {
  constructor(private readonly appealsService: AppealsService) {}

  @Post()
  @Policy(anyAuthenticatedUser)
  async create(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(safetyValidation.createAppealSchema)) body: CreateAppealBody,
  ): Promise<AppealCard> {
    const { id: userId } = requireAuthContext(request);
    const appeal = await this.appealsService.create(userId, body.moderation_action_id, body.reason);
    return toCard(appeal);
  }
}
