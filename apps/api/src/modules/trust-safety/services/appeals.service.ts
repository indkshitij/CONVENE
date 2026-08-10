import type { Appeal } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { NotFoundAppError, ValidationAppError } from "../../../common/errors/app-error";
import { APPEAL_SLA_HOURS } from "../report-catalogue";
import { AuditLogRepository } from "../../../common/audit/audit-log.repository";
import { AppealsRepository } from "../repositories/appeals.repository";
import { ModerationActionsRepository } from "../repositories/moderation-actions.repository";

// PRD §10.10.3: "Appeal (all levels) -> SLA 72h, human review", "Appeals
// are reviewed by a different admin than the one who acted."
@Injectable()
export class AppealsService {
  constructor(
    private readonly repo: AppealsRepository,
    private readonly moderationActionsRepo: ModerationActionsRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async create(userId: string, moderationActionId: string, reason: string): Promise<Appeal> {
    const action = await this.moderationActionsRepo.findById(moderationActionId);
    // 404 not 403 (established convention, see media/messaging's own
    // signed-URL and message-fetch endpoints): a caller can't learn
    // whether another user's moderation action even exists.
    if (!action || action.targetUserId !== userId) {
      throw new NotFoundAppError(
        "MODERATION_ACTION_NOT_FOUND",
        "This moderation action could not be found.",
      );
    }

    const now = new Date();
    const appeal = await this.repo.create({
      moderationActionId,
      userId,
      reason,
      slaDueAt: new Date(now.getTime() + APPEAL_SLA_HOURS * 60 * 60 * 1000),
    });

    await this.auditLog.record({
      actorId: userId,
      actorType: "user",
      action: "appeal.filed",
      entityType: "appeal",
      entityId: appeal.id,
      after: { moderation_action_id: moderationActionId },
    });

    return appeal;
  }

  async review(
    reviewerAdminId: string,
    appealId: string,
    decision: "upheld" | "overturned",
    rationale: string,
  ): Promise<Appeal> {
    const appeal = await this.repo.findById(appealId);
    if (!appeal) throw new NotFoundAppError("APPEAL_NOT_FOUND", "This appeal could not be found.");
    if (appeal.status !== "pending") {
      throw new ValidationAppError(
        "ACTION_NOT_PENDING_APPROVAL",
        "This appeal has already been decided.",
      );
    }

    const action = await this.moderationActionsRepo.findById(appeal.moderationActionId);
    if (!action)
      throw new NotFoundAppError(
        "MODERATION_ACTION_NOT_FOUND",
        "The underlying moderation action could not be found.",
      );
    if (reviewerAdminId === action.adminId) {
      throw new ValidationAppError(
        "APPEAL_REVIEWER_CONFLICT",
        "An appeal must be reviewed by a different admin than the one who acted.",
      );
    }

    const decided = await this.repo.decide(
      appealId,
      decision,
      reviewerAdminId,
      rationale,
      new Date(),
    );
    if (!decided) throw new Error("AppealsService: decide returned no row");

    if (decision === "overturned") {
      await this.moderationActionsRepo.reverse(action.id, reviewerAdminId, new Date());
      if (action.targetUserId)
        await this.moderationActionsRepo.setUserStatus(action.targetUserId, "active");
    }

    await this.auditLog.record({
      actorId: reviewerAdminId,
      actorType: "admin",
      action: "appeal.decided",
      entityType: "appeal",
      entityId: appealId,
      reason: rationale,
      after: { decision },
    });

    return decided;
  }
}
