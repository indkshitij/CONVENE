import type { ModerationAction } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { NotFoundAppError, ValidationAppError } from "../../../common/errors/app-error";
import {
  defaultExpiryFor,
  requiresTwoAdminApproval,
  userStatusForAction,
} from "../enforcement-ladder";
import { AuditLogRepository } from "../../../common/audit/audit-log.repository";
import { ModerationActionsRepository } from "../repositories/moderation-actions.repository";

export interface ApplyModerationActionInput {
  targetUserId: string;
  reportId: string | null;
  action: string;
  policyClause: string;
  rationale: string;
  expiresAt: Date | null;
}

// PRD §10.10.3: the enforcement ladder. Every step requires a policy
// clause and a written rationale before it can be applied (zod's
// applyModerationActionSchema already rejects an empty/missing one —
// POLICY_CLAUSE_REQUIRED here covers the one path that bypasses that
// schema: activating a ban whose original request somehow lacks one,
// which the NOT NULL DB column makes structurally impossible today but
// this guard documents the invariant explicitly rather than trusting the
// column silently). A permanent ban never applies immediately — it's
// recorded pending_approval until a second, distinct admin approves it.
@Injectable()
export class ModerationActionsService {
  constructor(
    private readonly repo: ModerationActionsRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async apply(actorAdminId: string, input: ApplyModerationActionInput): Promise<ModerationAction> {
    if (!input.policyClause.trim() || !input.rationale.trim()) {
      throw new ValidationAppError(
        "POLICY_CLAUSE_REQUIRED",
        "A policy clause and a written rationale are both required.",
      );
    }

    const now = new Date();
    const needsApproval = requiresTwoAdminApproval(input.action);
    const expiresAt = input.expiresAt ?? defaultExpiryFor(input.action, now);

    const created = await this.repo.create({
      targetUserId: input.targetUserId,
      reportId: input.reportId,
      adminId: actorAdminId,
      action: input.action,
      policyClause: input.policyClause,
      rationale: input.rationale,
      status: needsApproval ? "pending_approval" : "active",
      expiresAt,
    });

    await this.auditLog.record({
      actorId: actorAdminId,
      actorType: "admin",
      action: needsApproval ? "moderation.ban_requested" : "moderation.action_applied",
      entityType: "moderation_action",
      entityId: created.id,
      reason: input.rationale,
      after: { action: input.action, policy_clause: input.policyClause, status: created.status },
    });

    if (!needsApproval) {
      const status = userStatusForAction(input.action);
      if (status) await this.repo.setUserStatus(input.targetUserId, status);
    }

    return created;
  }

  // P18.1 addition beyond the PRD's 4 listed endpoints (see
  // admin-moderation-actions.controller.ts's own comment) — the concrete
  // mechanism the "two-admin approval" and "a permanent ban by a single
  // admin is rejected" testing criteria require.
  async approve(
    approvingAdminId: string,
    moderationActionId: string,
    rationale: string,
  ): Promise<ModerationAction> {
    const action = await this.repo.findById(moderationActionId);
    if (!action)
      throw new NotFoundAppError(
        "MODERATION_ACTION_NOT_FOUND",
        "This moderation action could not be found.",
      );
    if (action.status !== "pending_approval") {
      throw new ValidationAppError(
        "ACTION_NOT_PENDING_APPROVAL",
        "This action isn't awaiting approval.",
      );
    }
    if (approvingAdminId === action.adminId) {
      throw new ValidationAppError(
        "BAN_APPROVAL_SAME_ADMIN",
        "A permanent ban requires approval from a second, different admin.",
      );
    }

    const existingApprovals = await this.repo.listApprovals(moderationActionId);
    if (existingApprovals.some((approval) => approval.adminId === approvingAdminId)) {
      throw new ValidationAppError("ALREADY_APPROVED", "You've already approved this action.");
    }

    await this.repo.addApproval(moderationActionId, approvingAdminId, rationale);
    await this.auditLog.record({
      actorId: approvingAdminId,
      actorType: "admin",
      action: "moderation.ban_approved",
      entityType: "moderation_action",
      entityId: moderationActionId,
      reason: rationale,
    });

    const distinctAdmins = new Set<string>(existingApprovals.map((approval) => approval.adminId));
    distinctAdmins.add(approvingAdminId);
    if (action.adminId) distinctAdmins.add(action.adminId);

    if (distinctAdmins.size >= 2) {
      const activated = await this.repo.activate(moderationActionId);
      if (!activated) throw new Error("ModerationActionsService: activate returned no row");
      const status = userStatusForAction(activated.action);
      if (status && activated.targetUserId)
        await this.repo.setUserStatus(activated.targetUserId, status);
      await this.auditLog.record({
        actorId: approvingAdminId,
        actorType: "admin",
        action: "moderation.ban_activated",
        entityType: "moderation_action",
        entityId: moderationActionId,
        after: { status: "active" },
      });
      return activated;
    }

    return action;
  }

  async reverse(
    actorAdminId: string,
    moderationActionId: string,
    rationale: string,
  ): Promise<ModerationAction> {
    const action = await this.repo.findById(moderationActionId);
    if (!action)
      throw new NotFoundAppError(
        "MODERATION_ACTION_NOT_FOUND",
        "This moderation action could not be found.",
      );

    const reversed = await this.repo.reverse(moderationActionId, actorAdminId, new Date());
    if (!reversed) throw new Error("ModerationActionsService: reverse returned no row");

    // Simplification, documented: resets straight to "active" rather than
    // recomputing from any other overlapping restriction on the same
    // user — stacked/concurrent restrictions aren't modelled here.
    if (reversed.targetUserId && userStatusForAction(reversed.action)) {
      await this.repo.setUserStatus(reversed.targetUserId, "active");
    }

    await this.auditLog.record({
      actorId: actorAdminId,
      actorType: "admin",
      action: "moderation.action_reversed",
      entityType: "moderation_action",
      entityId: moderationActionId,
      reason: rationale,
    });

    return reversed;
  }
}
