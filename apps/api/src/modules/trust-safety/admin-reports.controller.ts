import type { Report } from "@convene/db";
import { safety as safetyValidation } from "@convene/validation";
import { Body, Controller, Get, Param, Patch, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import { auditContextFrom } from "../../common/audit/audit-request-context";
import { AuditLogRepository } from "../../common/audit/audit-log.repository";
import type { AuthContext } from "../../common/auth/auth-context";
import { adminOnly } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { Roles } from "../../common/auth/roles.guard";
import { NotFoundAppError, UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { MessagesRepository } from "../messaging/repositories/messages.repository";
import { ProfileService } from "../profile/profile.service";
import { ReportsRepository } from "./repositories/reports.repository";

interface RequestLike {
  authContext?: AuthContext;
  auditIp?: string;
  auditUserAgent?: string | null;
  requestId?: string;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type UpdateReportBody = z.infer<typeof safetyValidation.updateReportSchema>;

interface ReportCard {
  id: string;
  reference: string;
  target_type: string;
  target_id: string;
  target_user_id: string | null;
  category: string;
  severity: string;
  status: string;
  description: string | null;
  assigned_to: string | null;
  sla_due_at: string;
  created_at: string;
}

function toCard(row: Report): ReportCard {
  return {
    id: row.id,
    reference: row.reference,
    target_type: row.targetType,
    target_id: row.targetId,
    target_user_id: row.targetUserId,
    category: row.category,
    severity: row.severity,
    status: row.status,
    description: row.description,
    assigned_to: row.assignedTo,
    sla_due_at: row.slaDueAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

// PRD §10.10 endpoint 63: GET/PATCH /admin/reports. `mod` in §17.9's
// endpoint table maps to both admin and moderator roles (§17.4 RBAC).
@Controller("admin/reports")
export class AdminReportsController {
  constructor(
    private readonly reportsRepo: ReportsRepository,
    private readonly messagesRepo: MessagesRepository,
    private readonly profileService: ProfileService,
    private readonly auditLog: AuditLogRepository,
  ) {}

  // P26.1: the report queue's row-expansion content view. Bypasses the
  // normal conversation-membership/profile-privacy checks entirely (an
  // admin reviewing an impersonation or harassment report is exactly the
  // case those checks aren't meant to block) but writes an audit row
  // *before* returning anything, per §20.8 — a viewed-but-erroring read
  // still leaves a trace that the attempt was made.
  //
  // Only "message" and "profile"/"user" target types are wired up (the
  // two report categories that actually exist as content to review
  // today); any other target_type returns an honest
  // "unsupported_target_type" marker rather than fabricating a view.
  @Get(":id/content")
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async content(
    @Req() request: RequestLike,
    @Param("id") id: string,
  ): Promise<Record<string, unknown>> {
    const { id: adminId } = requireAuthContext(request);
    const report = await this.reportsRepo.findById(id);
    if (!report) throw new NotFoundAppError("REPORT_NOT_FOUND", "This report could not be found.");

    await this.auditLog.record({
      actorId: adminId,
      actorType: "admin",
      action: "report.content_viewed",
      entityType: "report",
      entityId: report.id,
      ...auditContextFrom(request),
    });

    if (report.targetType === "message") {
      const message = await this.messagesRepo.findMessageById(report.targetId);
      if (!message) return { target_type: "message", status: "content_unavailable" };
      return {
        target_type: "message",
        status: "ok",
        message: {
          id: message.id,
          conversation_id: message.conversationId,
          sender_id: message.senderId,
          body: message.body,
          type: message.type,
          deleted_at: message.deletedAt ? message.deletedAt.toISOString() : null,
          moderation_state: message.moderationState,
          created_at: message.createdAt.toISOString(),
        },
      };
    }

    if (report.targetType === "profile" || report.targetType === "user") {
      const targetUserId = report.targetUserId ?? report.targetId;
      try {
        const profile = await this.profileService.getProfileForAdminReview(targetUserId);
        return { target_type: report.targetType, status: "ok", profile };
      } catch {
        return { target_type: report.targetType, status: "content_unavailable" };
      }
    }

    return { target_type: report.targetType, status: "unsupported_target_type" };
  }

  @Get()
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async list(
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("category") category?: string,
  ): Promise<{ reports: ReportCard[] }> {
    const rows = await this.reportsRepo.listQueue({ status, severity, category }, 100);
    return { reports: rows.map(toCard) };
  }

  @Patch(":id")
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async update(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(safetyValidation.updateReportSchema)) body: UpdateReportBody,
  ): Promise<ReportCard> {
    requireAuthContext(request);
    const patch: { status?: string; assignedTo?: string | null } = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.assigned_to !== undefined) patch.assignedTo = body.assigned_to;
    const updated = await this.reportsRepo.update(id, patch);
    if (!updated) throw new NotFoundAppError("REPORT_NOT_FOUND", "This report could not be found.");
    return toCard(updated);
  }
}
