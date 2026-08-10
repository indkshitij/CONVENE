import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { PushNotificationWorker } from "../../workers/push-notification.worker";
import { ConversationsController } from "./conversations.controller";
import { MessageActionsController, MessageSearchController } from "./message-actions.controller";
import { MessagesController } from "./messages.controller";
import { ConversationsRepository } from "./repositories/conversations.repository";
import { MessagesRepository } from "./repositories/messages.repository";
import { LinkUnfurlService } from "./services/link-unfurl.service";
import { ConversationsService } from "./services/conversations.service";
import { MessagesService } from "./services/messages.service";
import { ModerationDeepScanService } from "./services/moderation-deep-scan.service";
import { ModerationFastPathService } from "./services/moderation-fast-path.service";
import { PushNotificationProducer } from "./services/push-notification.producer";
import { PushSender } from "./services/push-sender";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P15.1: the send path's four guarantees (durability, idempotency,
// ordering, gap-free catch-up — endpoints 38/39). Imports RealtimeModule
// for RealtimePublisherService (publish-after-commit to rt:conv:{id},
// same pattern every other fan-out-producing module uses).
// P15.2: edit/delete/reactions/forward/search (endpoints 40/41/42/45)
// plus the monologue limit, rate limits, and first-message quality nudge
// layered onto the send path.
// P15.3: conversation list/read/settings (endpoints 37/43/44), the 8s
// delayed-push scheduling+cancellation (BR-MSG-06), and the two-tier
// moderation hook (fast-path + async deep-scan retraction). Imports
// NotificationsModule for the deep-scan retraction's "sender is
// notified" step (BR-MSG-05's Gherkin scenario).
@Module({
  imports: [RealtimeModule, NotificationsModule],
  controllers: [
    MessagesController,
    MessageActionsController,
    MessageSearchController,
    ConversationsController,
  ],
  providers: [
    MessagesRepository,
    MessagesService,
    LinkUnfurlService,
    ModerationFastPathService,
    ModerationDeepScanService,
    PushNotificationProducer,
    PushSender,
    PushNotificationWorker,
    ConversationsRepository,
    ConversationsService,
  ],
  exports: [MessagesRepository, MessagesService, ModerationDeepScanService],
})
export class MessagingModule {}
