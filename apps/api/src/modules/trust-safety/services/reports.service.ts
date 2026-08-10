import type { Report } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { ConnectionsRepository } from "../../connections/repositories/connections.repository";
import {
  isReportCategory,
  REPORT_CATALOGUE,
  type AutoActionKind,
  type ReportCatalogueEntry,
} from "../report-catalogue";
import { defaultExpiryFor } from "../enforcement-ladder";
import { AuditLogRepository } from "../../../common/audit/audit-log.repository";
import { ModerationActionsRepository } from "../repositories/moderation-actions.repository";
import { ReportsRepository } from "../repositories/reports.repository";

export interface FileReportInput {
  reporterId: string | null;
  targetType: string;
  targetId: string;
  targetUserId: string | null;
  category: string;
  description: string | null;
  evidence?: Record<string, unknown> | undefined;
}

// PRD §10.10.2: eight report categories with SLAs from 1h (child safety)
// to 48h, and the documented auto-actions applied the moment a report is
// filed — before any human reviewer ever sees it.
@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    private readonly moderationActionsRepo: ModerationActionsRepository,
    private readonly auditLog: AuditLogRepository,
    @Optional() private readonly connectionsRepo?: ConnectionsRepository,
  ) {}

  async create(input: FileReportInput): Promise<Report> {
    const entry: ReportCatalogueEntry = isReportCategory(input.category)
      ? REPORT_CATALOGUE[input.category]
      : REPORT_CATALOGUE.other;
    const now = new Date();
    const slaDueAt = new Date(now.getTime() + entry.slaHours * 60 * 60 * 1000);

    const report = await this.repo.create({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      targetUserId: input.targetUserId,
      category: entry.category,
      severity: entry.severity,
      description: input.description,
      evidence: input.evidence ?? {},
      slaDueAt,
    });

    await this.auditLog.record({
      actorId: input.reporterId,
      actorType: input.reporterId ? "user" : "system",
      action: "report.filed",
      entityType: "report",
      entityId: report.id,
      after: {
        category: entry.category,
        severity: entry.severity,
        sla_due_at: slaDueAt.toISOString(),
      },
    });

    if (input.targetUserId) {
      await this.applyAutoAction(
        report,
        entry.autoAction,
        input.reporterId,
        input.targetUserId,
        now,
      );
    }

    return report;
  }

  private async applyAutoAction(
    report: Report,
    kind: AutoActionKind,
    reporterId: string | null,
    targetUserId: string,
    now: Date,
  ): Promise<void> {
    // Child-safety and threats/violence both freeze whatever conversation
    // the report came out of, when one exists (reporter and target are
    // connected) — reuses the same freeze primitive blocks.ts already
    // established (P14.2), not a new mechanism.
    if (
      (kind === "freeze_and_suspension_review" || kind === "freeze_and_throttle") &&
      reporterId &&
      this.connectionsRepo
    ) {
      await this.connectionsRepo.freezeConversationBetween(reporterId, targetUserId);
    }

    switch (kind) {
      case "immediate_suspension": {
        const action = await this.moderationActionsRepo.create({
          targetUserId,
          reportId: report.id,
          adminId: null,
          action: "suspend",
          policyClause: "AUTO-CHILD-SAFETY-IMMEDIATE",
          rationale:
            "Automated immediate suspension pending human review: child safety report filed.",
          status: "active",
          expiresAt: null,
        });
        await this.moderationActionsRepo.setUserStatus(targetUserId, "suspended");
        await this.recordAutoActionAudit(action.id, targetUserId);
        return;
      }
      case "freeze_and_suspension_review": {
        // "Suspension review" — a human still decides; only the freeze is
        // automatic. Logged as a notice so the queue shows it happened.
        const action = await this.moderationActionsRepo.create({
          targetUserId,
          reportId: report.id,
          adminId: null,
          action: "notice",
          policyClause: "AUTO-THREATS-VIOLENCE-FREEZE",
          rationale:
            "Automated conversation freeze pending suspension review: threats/violence report filed.",
          status: "active",
          expiresAt: null,
        });
        await this.recordAutoActionAudit(action.id, targetUserId);
        return;
      }
      case "freeze_and_throttle": {
        const expiresAt = defaultExpiryFor("throttle", now);
        const action = await this.moderationActionsRepo.create({
          targetUserId,
          reportId: report.id,
          adminId: null,
          action: "throttle",
          policyClause: "AUTO-HARASSMENT-THROTTLE",
          rationale:
            "Automated throttle pending review: harassment/hate or sexual-content report filed.",
          status: "active",
          expiresAt,
        });
        await this.moderationActionsRepo.setUserStatus(targetUserId, "restricted");
        await this.recordAutoActionAudit(action.id, targetUserId);
        return;
      }
      case "shadow_limit": {
        const expiresAt = defaultExpiryFor("shadow_limit", now);
        const action = await this.moderationActionsRepo.create({
          targetUserId,
          reportId: report.id,
          adminId: null,
          action: "shadow_limit",
          policyClause: "AUTO-SCAM-FRAUD-SHADOW-LIMIT",
          rationale: "Automated shadow-limit pending review: scam/fraud report filed.",
          status: "active",
          expiresAt,
        });
        await this.moderationActionsRepo.setUserStatus(targetUserId, "shadow_limited");
        await this.recordAutoActionAudit(action.id, targetUserId);
        return;
      }
      case "verification_challenge": {
        // No real verification-flow integration exists to trigger this —
        // recorded as a notice for a human/future system to act on
        // (same "hook exists, real provider deferred" posture used
        // elsewhere in this codebase for un-integrated systems).
        const action = await this.moderationActionsRepo.create({
          targetUserId,
          reportId: report.id,
          adminId: null,
          action: "notice",
          policyClause: "AUTO-IMPERSONATION-VERIFICATION-CHALLENGE",
          rationale:
            "Automated verification challenge queued pending review: impersonation report filed.",
          status: "active",
          expiresAt: null,
        });
        await this.recordAutoActionAudit(action.id, targetUserId);
        return;
      }
      case "rate_limit_reduction": {
        const expiresAt = defaultExpiryFor("throttle", now);
        const action = await this.moderationActionsRepo.create({
          targetUserId,
          reportId: report.id,
          adminId: null,
          action: "throttle",
          policyClause: "AUTO-SPAM-RATE-LIMIT",
          rationale: "Automated rate-limit reduction pending review: spam report filed.",
          status: "active",
          expiresAt,
        });
        await this.moderationActionsRepo.setUserStatus(targetUserId, "restricted");
        await this.recordAutoActionAudit(action.id, targetUserId);
        return;
      }
      case "queue_only":
        return;
    }
  }

  private async recordAutoActionAudit(
    moderationActionId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.auditLog.record({
      actorId: null,
      actorType: "system",
      action: "moderation.auto_action",
      entityType: "moderation_action",
      entityId: moderationActionId,
      after: { targetUserId },
    });
  }
}
