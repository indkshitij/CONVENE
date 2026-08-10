import type { Report } from "@convene/db";
import { safety as safetyValidation } from "@convene/validation";
import { Body, Controller, Post, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ReportsService } from "./services/reports.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type CreateReportBody = z.infer<typeof safetyValidation.createReportSchema>;

interface ReportCard {
  id: string;
  reference: string;
  category: string;
  severity: string;
  status: string;
  sla_due_at: string;
  created_at: string;
}

function toCard(row: Report): ReportCard {
  return {
    id: row.id,
    reference: row.reference,
    category: row.category,
    severity: row.severity,
    status: row.status,
    sla_due_at: row.slaDueAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

// PRD §10.10 endpoint 50: POST /reports.
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @Policy(anyAuthenticatedUser)
  async create(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(safetyValidation.createReportSchema)) body: CreateReportBody,
  ): Promise<ReportCard> {
    const { id: userId } = requireAuthContext(request);
    const report = await this.reportsService.create({
      reporterId: userId,
      targetType: body.target_type,
      targetId: body.target_id,
      targetUserId: body.target_user_id ?? null,
      category: body.category,
      description: body.description ?? null,
      evidence: body.evidence,
    });
    return toCard(report);
  }
}
