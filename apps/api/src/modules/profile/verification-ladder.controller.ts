import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { profile as profileValidation } from "@convene/validation";
import type { z } from "zod";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { VerificationLadderService } from "./verification-ladder.service";

type WorkEmailSendInput = z.infer<typeof profileValidation.workEmailSendSchema>;
type WorkEmailConfirmInput = z.infer<typeof profileValidation.workEmailConfirmSchema>;
type GovernmentIdInput = z.infer<typeof profileValidation.governmentIdSubmissionSchema>;

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.2.9 endpoint 16, §10.2.5 L3/L4. §10.2.9's own literal route
// contracts (POST /verification/work-email(/confirm), POST
// /me/verification/government-id) are treated as authoritative over the
// terse master endpoint-numbering table's "POST /me/verification/{level}"
// shorthand — same precedent as profile.controller.ts's own endpoint
// resolution.
@Controller()
export class VerificationLadderController {
  constructor(private readonly verificationLadderService: VerificationLadderService) {}

  @Post("verification/work-email")
  @HttpCode(202)
  @Policy(selfScoped)
  async sendWorkEmail(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.workEmailSendSchema)) body: WorkEmailSendInput,
  ): Promise<{ expires_at: string }> {
    const { id: userId } = requireAuthContext(request);
    const { expiresAt } = await this.verificationLadderService.sendWorkEmailCode(
      userId,
      body.target,
    );
    return { expires_at: expiresAt.toISOString() };
  }

  @Post("verification/work-email/confirm")
  @HttpCode(200)
  @Policy(selfScoped)
  async confirmWorkEmail(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.workEmailConfirmSchema))
    body: WorkEmailConfirmInput,
  ): Promise<{ verified: true }> {
    const { id: userId } = requireAuthContext(request);
    await this.verificationLadderService.confirmWorkEmailCode(userId, body.code);
    return { verified: true };
  }

  @Post("me/verification/government-id")
  @HttpCode(202)
  @Policy(selfScoped)
  async submitGovernmentId(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.governmentIdSubmissionSchema))
    body: GovernmentIdInput,
  ): Promise<{ submitted: true }> {
    const { id: userId } = requireAuthContext(request);
    await this.verificationLadderService.submitGovernmentId(userId, {
      provider: body.provider,
      providerReference: body.provider_reference,
      result: body.result,
    });
    return { submitted: true };
  }
}
