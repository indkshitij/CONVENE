import type { ModerationAction } from "@convene/db";
import { safety as safetyValidation } from "@convene/validation";
import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { adminOnly } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { Roles } from "../../common/auth/roles.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ModerationActionsRepository } from "./repositories/moderation-actions.repository";
import { ModerationActionsService } from "./services/moderation-actions.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type ApplyBody = z.infer<typeof safetyValidation.applyModerationActionSchema>;
type ApproveBody = z.infer<typeof safetyValidation.approveModerationActionSchema>;

interface ModerationActionCard {
  id: string;
  target_user_id: string | null;
  action: string;
  status: string;
  policy_clause: string;
  rationale: string;
  expires_at: string | null;
  created_at: string;
}

function toCard(row: ModerationAction): ModerationActionCard {
  return {
    id: row.id,
    target_user_id: row.targetUserId,
    action: row.action,
    status: row.status,
    policy_clause: row.policyClause,
    rationale: row.rationale,
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}

// PRD §10.10 endpoint 64: POST /admin/moderation-actions ("Apply
// action"). The `:id/approve` route is a P18.1 addition beyond that one
// listed endpoint: §10.10.3 requires "two-admin approval" for a
// permanent ban, and the prompt's own testing criteria ("a permanent ban
// by a single admin is rejected") can't be satisfied without a concrete
// second step for a second, different admin to take — flagged here, not
// silently invented, since no endpoint number in §17.9 covers it.
@Controller("admin/moderation-actions")
export class AdminModerationActionsController {
  constructor(
    private readonly moderationActionsService: ModerationActionsService,
    private readonly moderationActionsRepo: ModerationActionsRepository,
  ) {}

  // P26.1: the ban-approval queue UI needs to list actions awaiting a
  // second admin (?status=pending_approval) rather than looking them up
  // one id at a time.
  @Get()
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async list(
    @Query("status") status?: string,
  ): Promise<{ moderation_actions: ModerationActionCard[] }> {
    const rows = await this.moderationActionsRepo.list({ status }, 100);
    return { moderation_actions: rows.map(toCard) };
  }

  @Post()
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async apply(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(safetyValidation.applyModerationActionSchema)) body: ApplyBody,
  ): Promise<ModerationActionCard> {
    const { id: adminId } = requireAuthContext(request);
    const action = await this.moderationActionsService.apply(adminId, {
      targetUserId: body.target_user_id,
      reportId: body.report_id ?? null,
      action: body.action,
      policyClause: body.policy_clause,
      rationale: body.rationale,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
    });
    return toCard(action);
  }

  @Post(":id/approve")
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async approve(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(safetyValidation.approveModerationActionSchema)) body: ApproveBody,
  ): Promise<ModerationActionCard> {
    const { id: adminId } = requireAuthContext(request);
    const action = await this.moderationActionsService.approve(adminId, id, body.rationale);
    return toCard(action);
  }
}
