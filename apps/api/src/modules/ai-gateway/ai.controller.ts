import { Body, Controller, Post, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser, selfScoped } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  CareerGuidanceService,
  type CareerGuidanceResult,
} from "./features/career-guidance.service";
import {
  ConversationSummaryService,
  type ConversationSummaryResult,
} from "./features/conversation-summary.service";
import { IcebreakersService, type IcebreakersResult } from "./features/icebreakers.service";
import {
  type MentorRecommendationsResult,
  type NetworkingSuggestionsResult,
  NetworkingSuggestionsService,
} from "./features/networking-suggestions.service";
import {
  ProfileOptimisationService,
  type ProfileOptimisationResult,
} from "./features/profile-optimisation.service";
import { ResumeReviewService, type ResumeReviewResult } from "./features/resume-review.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

const icebreakersRequestSchema = z.object({ candidate_id: z.string().min(1) }).strict();
const firstMessageMetricSchema = z.object({ ai_drafted: z.boolean() }).strict();
const resumeReviewRequestSchema = z.object({ resume_text: z.string().min(1).max(20_000) }).strict();
const conversationSummaryRequestSchema = z.object({ conversation_id: z.string().min(1) }).strict();
const careerGuidanceRequestSchema = z.object({ question: z.string().min(1).max(1000) }).strict();
const networkingSuggestionsRequestSchema = z
  .object({ candidate_ids: z.array(z.string()).min(1).max(10) })
  .strict();
const mentorRecommendationsRequestSchema = z
  .object({ mentor_candidate_ids: z.array(z.string()).min(1).max(10) })
  .strict();

// PRD §17.9 endpoint 55: `POST /ai/{profile-optimize,icebreakers,resume-
// review,summarize,career-guidance,...}`. `networking-suggestions` and
// `mentor-recommendations` aren't in that literal list (§17.9 endpoint 56
// is `GET /ai/suggestions` for the weekly digest as a whole) — split into
// two POST routes here instead since this pass's reduced-scope
// implementation (see networking-suggestions.service.ts's own comment)
// generates on-demand from a caller-supplied candidate list rather than
// reading a precomputed weekly digest a batch job populated.
@Controller("ai")
export class AiController {
  constructor(
    private readonly icebreakersService: IcebreakersService,
    private readonly profileOptimisationService: ProfileOptimisationService,
    private readonly resumeReviewService: ResumeReviewService,
    private readonly conversationSummaryService: ConversationSummaryService,
    private readonly careerGuidanceService: CareerGuidanceService,
    private readonly networkingSuggestionsService: NetworkingSuggestionsService,
  ) {}

  @Post("icebreakers")
  @Policy(anyAuthenticatedUser)
  async icebreakers(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(icebreakersRequestSchema))
    body: z.infer<typeof icebreakersRequestSchema>,
  ): Promise<IcebreakersResult> {
    const authContext = requireAuthContext(request);
    return this.icebreakersService.generate(authContext, body.candidate_id);
  }

  @Post("profile-optimize")
  @Policy(selfScoped)
  async profileOptimize(@Req() request: RequestLike): Promise<ProfileOptimisationResult> {
    const authContext = requireAuthContext(request);
    return this.profileOptimisationService.generate(authContext);
  }

  // §12.4: owner-only — selfScoped means this always operates on the
  // caller's own resume text, there's no target-user parameter for it
  // to ever act on anyone else's.
  @Post("resume-review")
  @Policy(selfScoped)
  async resumeReview(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(resumeReviewRequestSchema))
    body: z.infer<typeof resumeReviewRequestSchema>,
  ): Promise<ResumeReviewResult> {
    const authContext = requireAuthContext(request);
    return this.resumeReviewService.generate(authContext, body.resume_text);
  }

  @Post("summarize")
  @Policy(anyAuthenticatedUser)
  async summarize(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(conversationSummaryRequestSchema))
    body: z.infer<typeof conversationSummaryRequestSchema>,
  ): Promise<ConversationSummaryResult> {
    const authContext = requireAuthContext(request);
    return this.conversationSummaryService.generate(authContext, body.conversation_id);
  }

  @Post("career-guidance")
  @Policy(anyAuthenticatedUser)
  async careerGuidance(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(careerGuidanceRequestSchema))
    body: z.infer<typeof careerGuidanceRequestSchema>,
  ): Promise<CareerGuidanceResult> {
    const authContext = requireAuthContext(request);
    return this.careerGuidanceService.ask(authContext, body.question);
  }

  @Post("networking-suggestions")
  @Policy(anyAuthenticatedUser)
  async networkingSuggestions(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(networkingSuggestionsRequestSchema))
    body: z.infer<typeof networkingSuggestionsRequestSchema>,
  ): Promise<NetworkingSuggestionsResult> {
    const authContext = requireAuthContext(request);
    return this.networkingSuggestionsService.suggestContacts(authContext, body.candidate_ids);
  }

  @Post("mentor-recommendations")
  @Policy(anyAuthenticatedUser)
  async mentorRecommendations(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(mentorRecommendationsRequestSchema))
    body: z.infer<typeof mentorRecommendationsRequestSchema>,
  ): Promise<MentorRecommendationsResult> {
    const authContext = requireAuthContext(request);
    return this.networkingSuggestionsService.mentorRationales(
      authContext,
      body.mentor_candidate_ids,
    );
  }

  // Not a PRD-literal endpoint — the §12.5 guardrail metric needs a
  // signal from wherever a first message is actually sent, and that's
  // owned by the connections module (BR-CONN-08: the request note *is*
  // the first message), not this one. This route lets the composer
  // report the one bit the gateway can't observe itself (did the sender
  // use an AI-drafted opener) without threading an AI-specific field
  // through the connections module's own request schema.
  @Post("first-message-metric")
  @Policy(anyAuthenticatedUser)
  recordFirstMessageMetric(
    @Body(new ZodValidationPipe(firstMessageMetricSchema))
    body: z.infer<typeof firstMessageMetricSchema>,
  ): { recorded: true } {
    this.icebreakersService.recordFirstMessageSent(body.ai_drafted);
    return { recorded: true };
  }
}
