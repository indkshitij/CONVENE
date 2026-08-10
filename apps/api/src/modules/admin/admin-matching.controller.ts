import { matching as matchingValidation } from "@convene/validation";
import { Body, Controller, Get, HttpCode, Post, Put, Req } from "@nestjs/common";
import type { AuthContext } from "../../common/auth/auth-context";
import { auditContextFrom } from "../../common/audit/audit-request-context";
import { Policy } from "../../common/auth/policy.guard";
import { adminOnly } from "../../common/auth/policies";
import { Roles } from "../../common/auth/roles.guard";
import { ConflictAppError, UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  FairnessAuditService,
  type FairnessAuditResult,
} from "../matching/services/fairness-audit.service";
import { MatchingWeightsProvider } from "../matching/services/matching-weights-provider";

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

// PRD §17.4 RBAC matrix: "Edit matching weights — admin only." AD-8: "live
// in remote config ... enables experimentation without deploys." §11.11's
// fairness audit, "instrumented from day one" per P12.3's own goal.
@Controller("admin/matching")
export class AdminMatchingController {
  constructor(
    private readonly weightsProvider: MatchingWeightsProvider,
    private readonly fairnessAudit: FairnessAuditService,
  ) {}

  @Get("weights")
  @Roles("admin")
  @Policy(adminOnly)
  async getWeights() {
    return this.weightsProvider.getActiveWeights();
  }

  // PRD AD-8/§11.11: "every change written to audit_logs and rejected
  // unless the weights sum to 1.00." A rejection is a 409 (the request
  // was well-formed but conflicts with the sum-to-1.00 invariant), not a
  // 400 — the shape was valid, the values weren't acceptable together.
  @Put("weights")
  @HttpCode(200)
  @Roles("admin")
  @Policy(adminOnly)
  async updateWeights(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(matchingValidation.updateMatchingWeightsSchema))
    body: matchingValidation.UpdateMatchingWeightsInput,
  ) {
    const { id: actorId } = requireAuthContext(request);
    const { reason, ...weights } = body;
    const result = await this.weightsProvider.proposeWeights(
      weights,
      actorId,
      reason,
      auditContextFrom(request),
    );
    if (!result.accepted) {
      throw new ConflictAppError("VALIDATION_FAILED", result.reason ?? "Weights were rejected.");
    }
    return result.weights;
  }

  // P26.2: "rollback to the previous configuration in one action."
  @Post("weights/rollback")
  @HttpCode(200)
  @Roles("admin")
  @Policy(adminOnly)
  async rollbackWeights(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(matchingValidation.rollbackMatchingWeightsSchema))
    body: matchingValidation.RollbackMatchingWeightsInput,
  ) {
    const { id: actorId } = requireAuthContext(request);
    const result = await this.weightsProvider.rollbackWeights(
      actorId,
      body.reason,
      auditContextFrom(request),
    );
    return result.weights;
  }

  @Get("fairness-audit")
  @Roles("admin")
  @Policy(adminOnly)
  async fairnessAuditReport(): Promise<FairnessAuditResult> {
    return this.fairnessAudit.runAudit();
  }
}
