import type { Appeal } from "@convene/db";
import { safety as safetyValidation } from "@convene/validation";
import { Body, Controller, Get, Param, Patch, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { adminOnly } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { Roles } from "../../common/auth/roles.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AppealsRepository } from "./repositories/appeals.repository";
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

type ReviewAppealBody = z.infer<typeof safetyValidation.reviewAppealSchema>;

interface AppealCard {
  id: string;
  moderation_action_id: string;
  status: string;
  reviewer_admin_id: string | null;
  decided_at: string | null;
}

function toCard(row: Appeal): AppealCard {
  return {
    id: row.id,
    moderation_action_id: row.moderationActionId,
    status: row.status,
    reviewer_admin_id: row.reviewerAdminId,
    decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

// P18.1 addition (see admin-moderation-actions.controller.ts's own
// comment on the same reasoning): §10.10.3 requires appeals be "reviewed
// by a different admin than the one who acted," which needs a review
// endpoint the PRD's §17.9 table doesn't separately number.
@Controller("admin/appeals")
export class AdminAppealsController {
  constructor(
    private readonly appealsService: AppealsService,
    private readonly appealsRepo: AppealsRepository,
  ) {}

  // P26.1: the appeals review queue UI needs a list (?status=pending),
  // same gap as moderation-actions — only single-id lookups existed
  // before.
  @Get()
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async list(@Query("status") status?: string): Promise<{ appeals: AppealCard[] }> {
    const rows = await this.appealsRepo.list({ status }, 100);
    return { appeals: rows.map(toCard) };
  }

  @Patch(":id/review")
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async review(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(safetyValidation.reviewAppealSchema)) body: ReviewAppealBody,
  ): Promise<AppealCard> {
    const { id: adminId } = requireAuthContext(request);
    const appeal = await this.appealsService.review(adminId, id, body.decision, body.rationale);
    return toCard(appeal);
  }
}
