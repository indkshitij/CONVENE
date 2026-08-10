import { Module } from "@nestjs/common";
import { MessagingModule } from "../messaging/messaging.module";
import { ToxicityEnforcementService } from "../messaging/services/toxicity-enforcement.service";
import { ToxicitySpamClassifierService } from "../messaging/services/toxicity-spam-classifier.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { ProfileModule } from "../profile/profile.module";
import { AiController } from "./ai.controller";
import { CareerGuidanceService } from "./features/career-guidance.service";
import { ConversationSummaryService } from "./features/conversation-summary.service";
import { IcebreakersService } from "./features/icebreakers.service";
import { NetworkingSuggestionsService } from "./features/networking-suggestions.service";
import { ProfileOptimisationService } from "./features/profile-optimisation.service";
import { ResumeReviewService } from "./features/resume-review.service";
import { AiGatewayService } from "./gateway.service";
import { AiQuotaService } from "./quota.service";
import {
  AI_MODEL_PROVIDER,
  AiRouterService,
  DeterministicStubAiModelProvider,
} from "./router.service";

// PRD §17.2 — see README.md in this directory for owned tables and
// events. P25.1 built the real pipeline; P25.2 added the two MVP
// features (§12.3, §12.5); P25.3 adds the rest (§12.4, §12.6-12.11).
// Imports MessagingModule for MessagesRepository (conversation summary)
// and ModerationDeepScanService (toxicity enforcement) rather than the
// reverse — MessagingModule has no need to know about AiGatewayService
// itself in this pass (nothing in the live send path calls the
// classifier synchronously yet, see toxicity-enforcement.service.ts's
// own scope note), which is what keeps this a one-directional import
// instead of a circular one. PostgresModule/RedisModule are both
// @Global, so neither needs an explicit import here.
@Module({
  imports: [ProfileModule, MessagingModule, NotificationsModule],
  controllers: [AiController],
  providers: [
    AiQuotaService,
    AiRouterService,
    AiGatewayService,
    IcebreakersService,
    ProfileOptimisationService,
    ResumeReviewService,
    ConversationSummaryService,
    CareerGuidanceService,
    NetworkingSuggestionsService,
    ToxicitySpamClassifierService,
    ToxicityEnforcementService,
    { provide: AI_MODEL_PROVIDER, useClass: DeterministicStubAiModelProvider },
  ],
  exports: [
    AiGatewayService,
    AiQuotaService,
    ToxicitySpamClassifierService,
    ToxicityEnforcementService,
  ],
})
export class AiGatewayModule {}
