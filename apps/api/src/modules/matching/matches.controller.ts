import { matchSuppressions } from "@convene/db";
import { explainScore, type ScoreExplanation } from "@convene/matching";
import { matching as matchingValidation } from "@convene/validation";
import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { AuthContext } from "../../common/auth/auth-context";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import { NotFoundAppError, UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { MatchingService } from "./services/matching.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §11 endpoint list (§17.9): 30 `/matches/{id}/explain`, 31
// `/matches/{id}/skip`. `{id}` is the candidate's user id — the viewer is
// always the authenticated caller (both routes are inherently self-scoped:
// "explain a match *for me*," "skip a match *for me*").
@Controller("matches")
export class MatchesController {
  constructor(
    private readonly matchingService: MatchingService,
    private readonly postgres: PostgresService,
  ) {}

  // PRD §11.10 risk R5: "shipped in this same prompt as the scorer, never
  // retrofitted." Reuses MatchingService.scoreCandidate() — the exact same
  // scoring call the feed itself makes — so the breakdown can never
  // disagree with a score the user was actually shown.

  @Get(":id/explain")
  @Policy(selfScoped)
  async explain(
    @Req() request: RequestLike,
    @Param("id") candidateId: string,
  ): Promise<ScoreExplanation> {
    const { id: viewerId } = requireAuthContext(request);
    const scored = await this.matchingService.scoreCandidate(viewerId, candidateId);
    if (!scored) {
      throw new NotFoundAppError("MATCH_NOT_FOUND", "This match is no longer available.");
    }
    const weights = await this.matchingService.getActiveWeights();
    return explainScore(scored.components, scored.multiplier, weights);
  }

  // PRD §11.8: skip suppresses this candidate from the viewer's future
  // feeds (match_suppressions — the same table G3 already gates every
  // recall source on) and "feeds ranking" — i.e. this candidate simply
  // stops appearing, which is itself the ranking feedback; no separate
  // signal-weighting mechanism exists to feed beyond that yet.
  @Post(":id/skip")
  @HttpCode(204)
  @Policy(selfScoped)
  async skip(
    @Req() request: RequestLike,
    @Param("id") candidateId: string,
    @Body(new ZodValidationPipe(matchingValidation.skipMatchSchema))
    body: matchingValidation.SkipMatchInput,
  ): Promise<void> {
    const { id: viewerId } = requireAuthContext(request);

    await this.postgres.db
      .insert(matchSuppressions)
      .values({
        userId: viewerId,
        suppressedId: candidateId,
        reason: body.reason ?? "not_interested",
      })
      .onConflictDoUpdate({
        target: [matchSuppressions.userId, matchSuppressions.suppressedId],
        set: { reason: body.reason ?? "not_interested" },
      });

    await this.matchingService.invalidateFeedCache(viewerId);
  }
}
